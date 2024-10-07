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
import { SNSEventRecord, SNSMessage } from "aws-lambda";

const {
  env: { AWS_REGION, S3_BUCKET, WEBSOCKET_URL, LOCAL_DIR },
} = process;

if (!AWS_REGION || !S3_BUCKET || !WEBSOCKET_URL || !LOCAL_DIR) {
  throw new Error("missing variable");
}

const s3Client = new S3Client({ region: AWS_REGION });

// Ensure the local sync directory exists
fs.mkdir(LOCAL_DIR, { recursive: true });

const ws = new WebSocket(WEBSOCKET_URL);

ws.on("open", () => {
  console.log("Connected to WebSocket server");
});

// eslint-disable-next-line require-await
ws.on("message", async (data) => {
  try {
    const message = JSON.parse(data.toString()) as SNSMessage;
    if (message.Type === "Notification") {
      const snsMessage = JSON.parse(message.Message) as {
        Records: SNSEventRecord[];
      };
      console.log("Received SNS notification:", snsMessage);

      //   if (snsMessage.Records) {
      //     for (const record of snsMessage.Records) {
      //       if (
      //         (record.eventName &&
      //           record.eventName.startsWith("ObjectCreated:")) ||
      //         record.eventName.startsWith("ObjectUpdated:")
      //       ) {
      //         const key = decodeURIComponent(
      //           record.s3.object.key.replace(/\+/g, " "),
      //         );
      //         await downloadFile(key);
      //       }
      //     }
      //   }
    }
  } catch (error) {
    console.error("Error processing WebSocket message:", error);
  }
});

ws.on("close", () => {
  console.log("Disconnected from WebSocket server");
});

async function downloadFile(key: string) {
  const localPath = path.join(LOCAL_DIR!, key);

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

async function uploadFile(localPath: string) {
  const key = path.relative(LOCAL_DIR!, localPath);

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

async function syncFile(localPath: string) {
  const key = path.relative(LOCAL_DIR!, localPath);

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
        await uploadFile(localPath);
      }
    } catch (error) {
      // If the file doesn't exist in S3, upload it
      await uploadFile(localPath);
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
