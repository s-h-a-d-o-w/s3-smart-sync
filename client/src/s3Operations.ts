import {
  _Object,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { logger } from "@s3-smart-sync/shared/logger.js";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, utimes } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { pipeline } from "stream/promises";
import {
  ACCESS_KEY,
  AWS_REGION,
  LOCAL_DIR,
  S3_BUCKET,
  SECRET_KEY,
} from "./consts.js";
import { FileOperationType, ignoreNext, unignoreNext } from "./fileWatcher.js";

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
    unignoreNext(FileOperationType.Sync, localPath);
  }
}

export async function convertAbsolutePathToKey(path: string) {
  try {
    const stats = await stat(path);
    if (stats.isDirectory()) {
      // For directories, ensure the key ends with a forward slash
      const preliminaryKey = relative(LOCAL_DIR, path).replaceAll("\\", "/");
      return preliminaryKey + (preliminaryKey.endsWith("/") ? "" : "/");
    }
  } catch (_) {
    // empty
  }

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

  if (key.endsWith("/")) {
    const { LastModified } = await s3Client.send(
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      }),
    );

    ignoreNext(FileOperationType.Sync, localPath);
    try {
      await mkdir(localPath, { recursive: true });
      await syncLastModified(localPath, LastModified);
    } finally {
      unignoreNext(FileOperationType.Sync, localPath);
    }

    logger.info(`Downloaded: ${key}`);
    return;
  }

  const { Body, LastModified } = await s3Client.send(
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }),
  );

  if (Body) {
    // We don't manage ignoring potentially new created directories here because that would be a lot of overhead. Instead, if syncing is triggered, we let the upload of the directory handle breaking that chain. (via updating modification time and that timestamp then being the same)
    await mkdir(dirname(localPath), { recursive: true });

    ignoreNext(FileOperationType.Sync, localPath);
    try {
      const writeStream = createWriteStream(localPath);
      await pipeline(Body.transformToWebStream(), writeStream);
      await syncLastModified(localPath, LastModified);
    } finally {
      unignoreNext(FileOperationType.Sync, localPath);
    }

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
      if (Key && LastModified) {
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
  await new Upload({
    client: s3Client,
    params: {
      Bucket: S3_BUCKET,
      Key: key,
      Body: key.endsWith("/") ? "" : createReadStream(localPath),
      // Hopefully will be optional in the future: https://github.com/aws/aws-sdk-js-v3/issues/6922
      ChecksumAlgorithm: "CRC32",
    },
  }).done();

  // We have to sync timestamps to avoid redundant, potentially infinite, operations.
  await syncLastModified(localPath, await getLastModified(key));
  logger.info(`Uploaded: ${key}`);
}

export async function upToDate(key: string) {
  let lastModifiedLocal: Date | undefined;
  try {
    lastModifiedLocal = (await stat(join(LOCAL_DIR, key))).mtime;
  } catch (_) {
    // File doesn't exist locally
    return false;
  }

  return (
    lastModifiedLocal?.valueOf() === (await getLastModified(key))?.valueOf()
  );
}
