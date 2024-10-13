import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import path, { relative } from "path";
import { logger } from "../utils/logger.js";
import { LOCAL_DIR, S3_BUCKET } from "./consts.js";
import { ignoreFiles, s3Client } from "./state.js";

export function convertAbsolutePathToKey(path: string) {
  return relative(LOCAL_DIR, path).replaceAll("\\", "/");
}

function getObjectInfo(key: string) {
  return s3Client.send(
    new HeadObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }),
  );
}

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
  const { Body, LastModified } = await s3Client.send(
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }),
  );

  if (Body) {
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, await Body.transformToByteArray());
    await syncLastModified(localPath, LastModified);

    logger.info(`Downloaded: ${key}`);
  } else {
    // TODO: Might make sense to retry a couple of times at increasing intervals.
    logger.error(`Couldn't get file data for: ${key}`);
  }
}

export async function upload(localPath: string, key: string) {
  const fileContent = await readFile(localPath);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: fileContent,
    }),
  );

  // We have to sync timestamps to avoid redundant, potentially infinite, operations in the future.
  await syncLastModified(localPath, (await getObjectInfo(key)).LastModified);

  logger.info(`Uploaded: ${key}`);
}
