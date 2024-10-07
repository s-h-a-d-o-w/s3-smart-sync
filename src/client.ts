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

const s3Client = new S3Client({ region: AWS_REGION });

// Ensure the local sync directory exists
fs.mkdir(LOCAL_DIR, { recursive: true });

const ws = new WebSocket(WEBSOCKET_URL);

ws.on("open", () => {
  console.log("Connected to WebSocket server");
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
});

async function downloadFile(key: string) {
  const localPath = path.join(LOCAL_DIR, key);

  try {
    const { Body } = await s3Client.send(
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      }),
    );

    if (Body) {
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, await Body.transformToByteArray());
      console.log(`Downloaded: ${key}`);
    }
  } catch (error) {
    console.error(`Error downloading file ${key}:`, error);
  }
}

async function removeLocalFile(key: string) {
  const localPath = path.join(LOCAL_DIR, key);

  try {
    await fs.unlink(localPath);
    console.log(`Removed local file: ${localPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`Error removing local file ${localPath}:`, error);
    } else {
      console.log(`File ${localPath} already removed or doesn't exist.`);
    }
  }
}

async function syncFile(localPath: string) {
  const key = path.relative(LOCAL_DIR, localPath);

  async function uploadFile() {
    try {
      const fileContent = await fs.readFile(localPath);
      await s3Client.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: fileContent,
        }),
      );
      console.log(`Uploaded: ${key}`);
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

// Watch for local file changes
const watcher = chokidar.watch(LOCAL_DIR);

watcher
  .on("add", syncFile)
  .on("change", syncFile)
  .on("unlink", async (localPath) => {
    const key = path.relative(LOCAL_DIR, localPath);
    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
        }),
      );
      console.log(`Deleted from S3: ${key}`);
    } catch (error) {
      console.error(`Error deleting file ${key} from S3:`, error);
    }
  });

console.log(`Watching for changes in ${LOCAL_DIR}`);
