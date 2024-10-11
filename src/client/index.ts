import "dotenv/config";

import { S3Event, SNSMessage } from "aws-lambda";
import chokidar from "chokidar";
import fs from "fs/promises";
import {
  createTrayIcon,
  destroyTrayIcon,
  updateTrayIconImage,
  updateTrayTooltip,
} from "node-tray"; // !!!!!!!! local !!!!!
import { join } from "path";
import WebSocket from "ws";
import { biDirectionalSync } from "./biDirectionalSync.js";
import { LOCAL_DIR, RECONNECT_DELAY, WEBSOCKET_URL } from "./consts.js";
import {
  convertAbsolutePathToKey,
  deleteObject,
  download,
  upload,
} from "./s3Operations.js";
import { trackFileOperation } from "./trackFileOperation.js";
import { ignoreFiles } from "./state.js";

const recentLocalDeletions = new Set<string>();
const recentDownloads = new Set<string>();
const recentDeletions = new Set<string>();
const recentUploads = new Set<string>();
// Time between remote operations have finished and the resulting S3 event that we will get - which is hopefully earlier than this timeout. May have to be increased for very slow connections but then one has to watch out not to actually change the same file within a period shorter than this.
const RECENT_REMOTE_TIMEOUT = 2000;
// Time between writing the download has finished and chokidar hopefully getting triggered earlier than this. May have to be increased for slow local drives but then one has to watch out not to actually change the same file within a period shorter than this.
const RECENT_LOCAL_TIMEOUT = 500;

createTrayIcon({
  icon: "./assets/icon_disconnected.ico",
  tooltip: "S3 Smart Sync",
  items: [
    {
      id: Symbol(),
      text: "Exit",
      onClick: () => {
        console.log("Exiting...");
        destroyTrayIcon();
        process.exit(0);
      },
    },
  ],
});

// Ensure the local sync directory exists
fs.mkdir(LOCAL_DIR, { recursive: true });
await biDirectionalSync();

function connectWebSocket() {
  const ws = new WebSocket(WEBSOCKET_URL);

  ws.on("open", () => {
    console.log(`Connected to ${WEBSOCKET_URL}`);
    updateTrayIconImage("./assets/icon.ico");
    updateTrayTooltip("S3 Smart Sync");
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
          trackFileOperation(key);

          if (record.eventName.startsWith("ObjectCreated:")) {
            await downloadFile(key);
          } else if (record.eventName.startsWith("ObjectRemoved:")) {
            await removeLocalFile(key);
          } else {
            throw new Error(
              "Received invalid record: " + JSON.stringify(record),
            );
          }
        }
      } else {
        throw new Error("Received invalid message: " + JSON.stringify(message));
      }
    } catch (error) {
      console.error("Error processing WebSocket message: ", error);
    }
  });

  ws.on("close", () => {
    console.log("Disconnected from WebSocket server");
    updateTrayIconImage("./assets/icon_disconnected.ico");
    updateTrayTooltip("S3 Smart Sync (Disconnected)");
    setTimeout(connectWebSocket, parseInt(RECONNECT_DELAY, 10));
  });
}

async function downloadFile(key: string) {
  if (recentUploads.has(key)) {
    console.log(`Skipping download for file recently uploaded to S3: ${key}`);
    return;
  }

  try {
    recentDownloads.add(key);

    await download(key, join(LOCAL_DIR, key));

    setTimeout(() => {
      recentDownloads.delete(key);
    }, RECENT_LOCAL_TIMEOUT);
  } catch (error) {
    recentDownloads.delete(key);
    console.error(`Error downloading file ${key}:`, error);
  }
}

async function removeLocalFile(key: string) {
  if (recentDeletions.has(key)) {
    console.log(
      `Skipping local removal for file recently deleted on S3: ${key}`,
    );
    return;
  }

  try {
    recentLocalDeletions.add(key);

    await fs.unlink(join(LOCAL_DIR, key));
    console.log(`Removed local file: ${key}`);

    setTimeout(() => {
      recentLocalDeletions.delete(key);
    }, RECENT_LOCAL_TIMEOUT);
  } catch (error) {
    recentLocalDeletions.delete(key);
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`Error removing local file ${key}:`, error);
    } else {
      console.log(`File ${key} already removed or doesn't exist.`);
    }
  }
}

async function removeFile(localPath: string) {
  const key = convertAbsolutePathToKey(localPath);
  if (recentLocalDeletions.has(key)) {
    console.log(
      `Skipping repeated S3 removal for recently deleted file: ${localPath}`,
    );
    return;
  }

  try {
    recentDeletions.add(key);

    await deleteObject(key);

    setTimeout(() => {
      recentDeletions.delete(key);
    }, RECENT_REMOTE_TIMEOUT);
  } catch (error) {
    recentDeletions.delete(key);
    console.error(`Error deleting file ${key} from S3:`, error);
  }
}

async function syncFile(localPath: string) {
  if (ignoreFiles.has(localPath)) {
    return;
  }

  const key = convertAbsolutePathToKey(localPath);
  if (recentDownloads.has(key)) {
    console.log(`Skipping upload for recently downloaded file: ${localPath}`);
    return;
  }

  trackFileOperation(key);

  try {
    recentUploads.add(key);

    await upload(localPath, key);

    setTimeout(() => {
      recentUploads.delete(key);
    }, RECENT_REMOTE_TIMEOUT);
  } catch (error) {
    recentUploads.delete(key);
    console.error(`Error uploading file ${key}:`, error);
  }
}

// Don't use for`awaitWriteFinish` because that would cause conflicts with the RECENT_TIMEOUT. Because that time only starts once writing has finished, potential `add` events during writing are ignored anyway.
const watcher = chokidar.watch(LOCAL_DIR, {
  ignoreInitial: true,
});
watcher.on("add", syncFile).on("change", syncFile).on("unlink", removeFile);

console.log(`Watching for changes in ${LOCAL_DIR}`);

connectWebSocket();
