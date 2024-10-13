import "dotenv/config";

import { S3Event, SNSMessage } from "aws-lambda";
import chokidar from "chokidar";
import fs, { stat } from "fs/promises";
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
import debounce from "lodash/debounce.js";
import { logger } from "../utils/logger.js";

const recentLocalDeletions = new Set<string>();
const recentDownloads = new Set<string>();
const recentDeletions = new Set<string>();
const recentUploads = new Set<string>();
// Time between remote operations have finished and the resulting S3 event (SNS) that we will get - which is hopefully earlier than this timeout. May have to be increased for very slow connections but then one has to watch out not to actually change the same file within a period shorter than this.
const RECENT_REMOTE_TIMEOUT = 3000;
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
        logger.info("Exiting...");
        destroyTrayIcon();
        process.exit(0);
      },
    },
  ],
});

async function main() {
  // Ensure the local sync directory exists
  fs.mkdir(LOCAL_DIR, { recursive: true });
  await biDirectionalSync();

  function connectWebSocket() {
    const ws = new WebSocket(WEBSOCKET_URL);

    ws.on("open", () => {
      logger.info(`Connected to ${WEBSOCKET_URL}`);
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
          throw new Error(
            "Received invalid message: " + JSON.stringify(message),
          );
        }
      } catch (error) {
        logger.error("Error processing WebSocket message: ", error);
      }
    });

    ws.on("close", () => {
      logger.info("Disconnected from WebSocket server");
      updateTrayIconImage("./assets/icon_disconnected.ico");
      updateTrayTooltip("S3 Smart Sync (Disconnected)");
      setTimeout(connectWebSocket, parseInt(RECONNECT_DELAY, 10));
    });
  }

  async function downloadFile(key: string) {
    if (recentUploads.has(key)) {
      logger.info(`Skipping download for file recently uploaded to S3: ${key}`);
      return;
    }

    try {
      recentDownloads.add(key);
      logger.debug(`downloadFile: added ${key} to recent downloads`);

      const fullPath = join(LOCAL_DIR, key);
      await download(key, fullPath);
      const { size } = await stat(fullPath);
      trackFileOperation(key, size);

      setTimeout(() => {
        recentDownloads.delete(key);
        logger.debug(`downloadFile: removed ${key} from recent downloads`);
      }, RECENT_LOCAL_TIMEOUT);
    } catch (error) {
      recentDownloads.delete(key);
      logger.error(`Error downloading file ${key}:`, error);
    }
  }

  async function removeLocalFile(key: string) {
    if (recentDeletions.has(key)) {
      logger.info(
        `Skipping local removal for file recently deleted on S3: ${key}`,
      );
      return;
    }

    try {
      recentLocalDeletions.add(key);
      logger.debug(`removeLocalFile: added ${key} to recent local deletions`);

      await fs.unlink(join(LOCAL_DIR, key));
      trackFileOperation(key);
      logger.info(`Removed local file: ${key}`);

      setTimeout(() => {
        recentLocalDeletions.delete(key);
        logger.debug(
          `removeLocalFile: removed ${key} from recent local deletions`,
        );
      }, RECENT_LOCAL_TIMEOUT);
    } catch (error) {
      recentLocalDeletions.delete(key);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.error(`Error removing local file ${key}:`, error);
      } else {
        logger.info(`File ${key} already removed or doesn't exist.`);
      }
    }
  }

  async function removeFile(localPath: string) {
    const key = convertAbsolutePathToKey(localPath);
    if (recentLocalDeletions.has(key)) {
      logger.info(
        `Skipping repeating S3 removal for recently deleted file: ${localPath}`,
      );
      return;
    }

    try {
      recentDeletions.add(key);
      logger.debug(`removeFile: added ${localPath} to recent S3 deletions`);

      await deleteObject(key);
      trackFileOperation(key);

      setTimeout(() => {
        recentDeletions.delete(key);
        logger.debug(
          `removeFile: removed ${localPath} from recent S3 deletions`,
        );
      }, RECENT_REMOTE_TIMEOUT);
    } catch (error) {
      recentDeletions.delete(key);
      logger.error(`Error deleting file ${key} from S3:`, error);
    }
  }

  async function syncFile(localPath: string) {
    const key = convertAbsolutePathToKey(localPath);
    if (recentDownloads.has(key)) {
      logger.info(`Skipping upload for recently downloaded file: ${localPath}`);
      return;
    }

    try {
      recentUploads.add(key);
      logger.debug(`syncFile: added ${localPath} to recent uploads`);

      await upload(localPath, key);
      const { size } = await stat(localPath);
      trackFileOperation(key, size);

      setTimeout(() => {
        recentUploads.delete(key);
        logger.debug(`syncFile: removed ${localPath} from recent uploads`);
      }, RECENT_REMOTE_TIMEOUT);
    } catch (error) {
      recentUploads.delete(key);
      logger.error(`Error uploading file ${key}:`, error);
    }
  }

  // Don't use for`awaitWriteFinish` because that would cause conflicts with the RECENT_TIMEOUT. Because that time only starts once writing has finished, potential `add` events during writing are ignored anyway.
  const watcher = chokidar.watch(LOCAL_DIR, {
    ignoreInitial: true,
  });

  const debounceMap: Record<string, () => void> = {};
  function getDebouncedFunction(
    which: "sync" | "remove",
    localPath: string,
  ): () => void {
    const key = which + localPath;
    if (!debounceMap[key]) {
      debounceMap[key] = debounce(() => {
        if (which === "sync") {
          syncFile(localPath);
        } else {
          removeFile(localPath);
        }

        delete debounceMap[key];
      }, 500);
    }
    return debounceMap[key];
  }

  const wrappedDebouncedSyncFile = (localPath: string) => {
    // Ignore triggers caused by timestamp syncing.
    if (ignoreFiles.has(localPath)) {
      logger.debug(`debouncedSyncFile: ignored ${localPath}.`);
      return;
    }

    logger.debug(`debouncedSyncFile: triggering syncing ${localPath}.`);
    getDebouncedFunction("sync", localPath)();
  };
  const wrappedDebouncedRemoveFile = (localPath: string) => {
    // Ignore triggers caused by timestamp syncing.
    if (ignoreFiles.has(localPath)) {
      logger.debug(`debouncedRemoveFile: ignored ${localPath}.`);
      return;
    }

    logger.debug(`debouncedRemoveFile: triggering removing ${localPath}.`);
    getDebouncedFunction("remove", localPath)();
  };

  watcher
    .on("add", wrappedDebouncedSyncFile)
    .on("change", wrappedDebouncedSyncFile)
    .on("unlink", wrappedDebouncedRemoveFile);

  logger.info(`Watching for changes in ${LOCAL_DIR}`);

  connectWebSocket();
}

main();
