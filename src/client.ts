import "dotenv/config";

import WebSocket from "ws";
import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import chokidar from "chokidar";
import fs from "fs/promises";
import path from "path";
import { SNSMessage, S3Event } from "aws-lambda";
import { getEnvironmentVariables } from "./getEnvironmentVariables.js";

const { AWS_REGION, S3_BUCKET, WEBSOCKET_URL, LOCAL_DIR } =
  getEnvironmentVariables(
    "AWS_REGION",
    "S3_BUCKET",
    "WEBSOCKET_URL",
    "LOCAL_DIR",
  );

const recentLocalDeletions = new Set<string>();
const recentDownloads = new Set<string>();
const recentDeletions = new Set<string>();
const recentUploads = new Set<string>();
// Time between remote operations have finished and the resulting S3 event that we will get - which is hopefully earlier than this timeout.
const RECENT_REMOTE_TIMEOUT = 2000;
// Time between writing the download has finished and chokidar hopefully getting triggered earlier than this.
const RECENT_LOCAL_TIMEOUT = 500;

const s3Client = new S3Client({ region: AWS_REGION });

// Ensure the local sync directory exists
fs.mkdir(LOCAL_DIR, { recursive: true });

const ws = new WebSocket(WEBSOCKET_URL);

ws.on("open", () => {
  console.log(`Connected to ${WEBSOCKET_URL}`);
});

ws.on("message", async (data) => {
  try {
    const message = JSON.parse(data.toString()) as SNSMessage;
    if (message.Type === "Notification") {
      const snsMessage = JSON.parse(message.Message) as S3Event;

      for (const record of snsMessage.Records) {
        const key = decodeURIComponent(
          record.s3.object.key.replace(/\+/g, " "),
        );

        if (record.eventName.startsWith("ObjectCreated:")) {
          await downloadFile(key);
        } else if (record.eventName.startsWith("ObjectRemoved:")) {
          await removeLocalFile(key);
        } else {
          throw new Error("Invalid event received: " + JSON.stringify(message));
        }
      }
    }
  } catch (error) {
    console.error("Error processing WebSocket message: ", error);
  }
});

ws.on("close", () => {
  console.log("Disconnected from WebSocket server");
  process.exit(1);
});

async function downloadFile(key: string) {
  const localPath = path.join(LOCAL_DIR, key);
  if (recentUploads.has(localPath)) {
    console.log(
      `Skipping download for file recently uploaded to S3: ${localPath}`,
    );
    return;
  }

  try {
    const { Body } = await s3Client.send(
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      }),
    );

    if (Body) {
      recentDownloads.add(localPath);

      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, await Body.transformToByteArray());
      console.log(`Downloaded: ${key}`);

      // Start timeout only after writing the file has finished
      setTimeout(() => {
        recentDownloads.delete(localPath);
      }, RECENT_LOCAL_TIMEOUT);
    }
  } catch (error) {
    console.error(`Error downloading file ${key}:`, error);
  }
}

async function removeLocalFile(key: string) {
  const localPath = path.join(LOCAL_DIR, key);
  if (recentDeletions.has(localPath)) {
    console.log(
      `Skipping local removal for file recently deleted on S3: ${localPath}`,
    );
    return;
  }

  try {
    recentLocalDeletions.add(localPath);

    await fs.unlink(localPath);
    console.log(`Removed local file: ${localPath}`);

    setTimeout(() => {
      recentLocalDeletions.delete(localPath);
    }, RECENT_LOCAL_TIMEOUT);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`Error removing local file ${localPath}:`, error);
    } else {
      console.log(`File ${localPath} already removed or doesn't exist.`);
    }
  }
}

async function removeFile(localPath: string) {
  if (recentLocalDeletions.has(localPath)) {
    console.log(
      `Skipping repeated S3 removal for recently deleted file: ${localPath}`,
    );
    return;
  }

  const key = path.relative(LOCAL_DIR, localPath);

  try {
    recentDeletions.add(localPath);

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      }),
    );
    console.log(`Deleted from S3: ${key}`);

    setTimeout(() => {
      recentDeletions.delete(localPath);
    }, RECENT_REMOTE_TIMEOUT);
  } catch (error) {
    console.error(`Error deleting file ${key} from S3:`, error);
  }
}

async function syncFile(localPath: string) {
  if (recentDownloads.has(localPath)) {
    console.log(`Skipping upload for recently downloaded file: ${localPath}`);
    return;
  }

  const key = path.relative(LOCAL_DIR, localPath);

  async function uploadFile() {
    try {
      recentUploads.add(localPath);

      const fileContent = await fs.readFile(localPath);
      await s3Client.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: fileContent,
        }),
      );
      console.log(`Uploaded: ${key}`);

      setTimeout(() => {
        recentUploads.delete(localPath);
      }, RECENT_REMOTE_TIMEOUT);
    } catch (error) {
      console.error(`Error uploading file ${key}:`, error);
    }
  }

  try {
    const localStat = await fs.stat(localPath);

    try {
      const { LastModified } = await s3Client.send(
        new HeadObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
        }),
      );

      if (LastModified && localStat.mtime > LastModified) {
        await uploadFile();
      }
    } catch (error) {
      // If the file doesn't exist in S3, upload it
      await uploadFile();
    }
  } catch (error) {
    console.error(`Error syncing file ${key}:`, error);
  }
}

// Don't use for`awaitWriteFinish` because that would cause conflicts with the RECENT_TIMEOUT. Because that time only starts once writing has finished, potential `add` events during writing are ignored anyway.
const watcher = chokidar.watch(LOCAL_DIR, {
  ignoreInitial: true,
});
watcher.on("add", syncFile).on("change", syncFile).on("unlink", removeFile);

console.log(`Watching for changes in ${LOCAL_DIR}`);
