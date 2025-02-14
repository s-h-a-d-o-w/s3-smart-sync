import { statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "@s3-smart-sync/shared/logger.js";
import { LOCAL_DIR } from "./consts.js";
import {
  convertAbsolutePathToKey,
  download,
  listS3Files,
  upload,
} from "./s3Operations.js";
import { destroyTrayIcon } from "./trayWrapper.js";

async function listLocalFiles(dir: string) {
  const files: Array<{
    key: string;
    lastModified: Date;
  }> = [];

  const directoryEntries = await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  });
  directoryEntries.forEach((dummy) => {
    // No destructuring here because node code uses `this`.
    if (dummy.isFile()) {
      const fullPath = join(dummy.parentPath, dummy.name);
      // TODO: check whether file really is in the format of a key
      files.push({
        key: convertAbsolutePathToKey(fullPath),
        lastModified: statSync(fullPath).mtime,
      });
    }
  });

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

  const [localFiles, [s3Files, noLastModifiedInfo]] = await Promise.all([
    listLocalFiles(LOCAL_DIR),
    listS3Files(),
  ]);
  if (noLastModifiedInfo.length > 0) {
    logger.error(
      `No "last modified" date from S3 for file(s): ${noLastModifiedInfo.join(", ")}.\nPlease address this before starting the client again.`,
    );
    destroyTrayIcon();
    process.exit(1);
  }

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
