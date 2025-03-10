import { statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "@s3-smart-sync/shared/logger.js";
import { LOCAL_DIR, S3_BUCKET } from "./consts.js";
import {
  convertAbsolutePathToKey,
  deleteObject,
  download,
  listS3Files,
  s3Client,
  upload,
} from "./s3Operations.js";
import { destroyTrayIcon } from "./trayWrapper.js";
import { _Object, ListObjectsV2Command } from "@aws-sdk/client-s3";

async function listLocalFiles(dir: string) {
  const files: Array<{
    key: string;
    lastModified: Date;
  }> = [];

  const directoryEntries = await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  });
  await Promise.all(
    // No destructuring of `entry` because node code relies on `this`!
    directoryEntries.map(async (entry) => {
      const fullPath = join(entry.parentPath, entry.name);
      files.push({
        key: await convertAbsolutePathToKey(fullPath),
        lastModified: statSync(fullPath).mtime,
      });
    }),
  );

  return files;
}

// This sync is obviously purely additive because we can't know about possible deletions that happened in the past.
let isSyncInProgress = false;
export async function biDirectionalSync() {
  if (isSyncInProgress) {
    return;
  }

  logger.info("Starting full sync...");
  isSyncInProgress = true;

  const [preliminaryS3Files, noLastModifiedInfo] = await listS3Files();
  if (noLastModifiedInfo.length > 0) {
    logger.error(
      `No "last modified" date from S3 for file(s): ${noLastModifiedInfo.join(", ")}.\nPlease address this before starting the client again.`,
    );
    destroyTrayIcon();
    process.exit(1);
  }

  const fixConflictsPromises = await fixConflicts(preliminaryS3Files);
  // It's possible that some things are attempted to be deleted twice for various reasons. Obviously, we don't care about errors thrown because something that caused the config was already deleted.
  await Promise.allSettled(fixConflictsPromises);

  const [localFiles, [s3Files]] = await Promise.all([
    listLocalFiles(LOCAL_DIR),
    listS3Files(),
  ]);

  const localPromises = localFiles
    .map(({ key, lastModified }) => {
      const s3File = s3Files.find((s3File) => s3File.key === key);
      if (!s3File || lastModified > s3File.lastModified) {
        return upload(join(LOCAL_DIR, key), key);
      }
    })
    .filter((task) => task !== undefined);

  const s3Promises = s3Files
    .map(({ key, lastModified }) => {
      const localFile = localFiles.find((localFile) => localFile.key === key);
      if (!localFile || lastModified > localFile.lastModified) {
        return download(key, join(LOCAL_DIR, key));
      }
    })
    .filter((task) => task !== undefined);

  await Promise.allSettled([...localPromises, ...s3Promises]).then(
    (results) => {
      if (results.some(({ status }) => status === "rejected")) {
        logger.error(
          "The following errors were encountered during syncing:\n" +
            (
              results.filter(
                ({ status }) => status === "rejected",
              ) as PromiseRejectedResult[]
            )
              .map(({ reason }) => String(reason))
              .join("\n"),
        );
      }
    },
  );

  isSyncInProgress = false;
  logger.info("Done.\n");
}

async function fixConflicts(
  s3Files: Array<{ key: string; lastModified: Date }>,
) {
  const deletePromises: Promise<void>[] = [];

  const keyMap = new Map<string, Array<{ key: string; lastModified: Date }>>();
  for (const file of s3Files) {
    const baseKey = file.key.endsWith("/") ? file.key.slice(0, -1) : file.key;
    if (!keyMap.has(baseKey)) {
      keyMap.set(baseKey, []);
    }
    keyMap.get(baseKey)!.push(file);
  }

  // Find conflicts (where both a file and directory with the same baseKey exist)
  for (const entries of keyMap.values()) {
    if (entries.length === 2) {
      const directory = entries[0]!.key.endsWith("/")
        ? entries[0]!
        : entries[1]!;
      const file = entries[0]!.key.endsWith("/") ? entries[1]! : entries[0]!;

      if (file.lastModified < directory.lastModified) {
        logger.info(
          `Resolving conflict: deleting file ${file.key} (keeping ${directory.key})`,
        );
        deletePromises.push(deleteObject(file.key));
      } else {
        logger.info(
          `Resolving conflict: deleting directory ${directory.key} (keeping ${file.key})`,
        );
        deletePromises.push(deleteObject(directory.key));

        // Also delete all objects found under this directory
        let continuationToken: string | undefined = undefined;
        do {
          const { Contents, NextContinuationToken } = (await s3Client.send(
            new ListObjectsV2Command({
              Bucket: S3_BUCKET,
              Prefix: directory.key,
              ...(continuationToken
                ? { ContinuationToken: continuationToken }
                : {}),
            }),
          )) as {
            Contents?: _Object[];
            NextContinuationToken: string | undefined;
          };

          if (Contents && Contents.length > 0) {
            for (const { Key } of Contents) {
              if (Key) {
                deletePromises.push(deleteObject(Key));
              }
            }
          }

          continuationToken = NextContinuationToken;
        } while (continuationToken);
      }
    } else if (entries.length > 2) {
      logger.error(
        `Found ${entries.length} conflicting entries for "${entries[0]!.key}": ${entries.map((e) => e.key).join(", ")}`,
      );
    }
  }

  return deletePromises;
}
