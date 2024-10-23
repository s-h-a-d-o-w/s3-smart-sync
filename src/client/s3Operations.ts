import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { logger } from "../utils/logger.js";
import { LOCAL_DIR, S3_BUCKET } from "./consts.js";
import { ignoreFiles, s3Client } from "./state.js";

async function syncLastModified(localPath: string, lastModified?: Date) {
  if (lastModified) {
    ignoreFiles.add(localPath);
    logger.debug(`syncLastModified: added ${localPath} to ignore files.`);
    await utimes(localPath, lastModified, lastModified);
    // Give chokidar an opportunity to get triggered.
    setTimeout(() => {
      ignoreFiles.delete(localPath);
      logger.debug(`syncLastModified: removed ${localPath} from ignore files.`);
    }, 100);
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
    await writeFile(localPath, await Body.transformToByteArray());
    await syncLastModified(localPath, LastModified);

    logger.info(`Downloaded: ${key}`);
  } else {
    // TODO: Might make sense to retry a couple of times at increasing intervals.
    logger.error(`Couldn't get file data for: ${key}`);
  }
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
