import {
  _Object,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { logger } from "@s3-smart-sync/shared/logger.js";
import {
  ACCESS_KEY,
  AWS_REGION,
  LOCAL_DIR,
  S3_BUCKET,
  SECRET_KEY,
} from "./consts.js";
import { FileOperationType, ignoreNext } from "./fileWatcher.js";

export const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});

async function syncLastModified(localPath: string, lastModified?: Date) {
  if (lastModified) {
    logger.debug(`syncLastModified: added ${localPath} to ignore files.`);
    ignoreNext(FileOperationType.Sync, localPath);
    await utimes(localPath, lastModified, lastModified);
  }
}

export function convertAbsolutePathToKey(path: string) {
  return relative(LOCAL_DIR, path).replaceAll("\\", "/");
}

export async function getLastModified(key: string) {
  return (
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      }),
    )
  ).LastModified;
}

export async function deleteObject(key: string) {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }),
  );

  logger.info(`Deleted from S3: ${key}`);
}

export async function download(key: string, localPath: string) {
  logger.info(`Downloading: ${key}`);
  const { Body, LastModified } = await s3Client.send(
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }),
  );

  if (Body) {
    await mkdir(dirname(localPath), { recursive: true });
    ignoreNext(FileOperationType.Sync, localPath);
    await writeFile(localPath, await Body.transformToByteArray());
    await syncLastModified(localPath, LastModified);

    logger.info(`Downloaded: ${key}`);
  } else {
    // TODO: Might make sense to retry a couple of times at increasing intervals.
    logger.error(`Couldn't get file data for: ${key}`);
  }
}

export async function listS3Files() {
  let continuationToken: string | undefined = undefined;
  const files: Array<{
    key: string;
    lastModified: Date;
  }> = [];
  const filesWithoutLastModified: string[] = [];

  do {
    const { Contents, NextContinuationToken } = (await s3Client.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      }),
    )) as {
      Contents?: _Object[];
      NextContinuationToken: string | undefined;
    };
    Contents?.forEach(({ Key, LastModified }) => {
      if (Key?.endsWith("/")) {
        // Ignore directories
        return;
      } else if (Key && LastModified) {
        files.push({ key: Key, lastModified: LastModified });
      } else if (Key && !LastModified) {
        filesWithoutLastModified.push(Key);
      }
    });
    continuationToken = NextContinuationToken;
  } while (continuationToken);

  return [files, filesWithoutLastModified] as const;
}

export async function upload(localPath: string, key: string) {
  logger.info(`Uploading: ${key}`);
  const fileContent = await readFile(localPath);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: fileContent,
    }),
  );

  // We have to sync timestamps to avoid redundant, potentially infinite, operations in the future.
  await syncLastModified(localPath, await getLastModified(key));
  logger.info(`Uploaded: ${key}`);
}

export async function upToDate(key: string) {
  const fullPath = join(LOCAL_DIR, key);

  const lastModifiedRemote = await getLastModified(key);
  let lastModifiedLocal: Date | undefined;
  try {
    lastModifiedLocal = (await stat(fullPath)).mtime;
  } catch (_) {
    // File doesn't exist locally
  }

  return lastModifiedLocal?.valueOf() === lastModifiedRemote?.valueOf();
}
