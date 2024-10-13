import "dotenv/config";

import fs, { stat } from "fs/promises";
import { join } from "path";
import { logger } from "../utils/logger.js";
import { biDirectionalSync } from "./biDirectionalSync.js";
import { LOCAL_DIR } from "./consts.js";
import {
  convertAbsolutePathToKey,
  deleteObject,
  download,
  upload,
} from "./s3Operations.js";
import { setUpFileWatcher } from "./setUpFileWatcher.js";
import { setUpWebsocket } from "./setUpWebsocket.js";
import { trackFileOperation } from "./trackFileOperation.js";
import {
  changeTrayIconState,
  setUpTrayIcon,
  TrayIconState,
} from "./setUpTrayIcon.js";

const recentLocalDeletions = new Set<string>();
const recentDownloads = new Set<string>();
const recentDeletions = new Set<string>();
const recentUploads = new Set<string>();
// Time between remote operations have finished and the resulting S3 event (SNS) that we will get - which is hopefully earlier than this timeout. May have to be increased for very slow connections but then one has to watch out not to actually change the same file within a period shorter than this.
const RECENT_REMOTE_TIMEOUT = 3000;
// Time between writing the download has finished and chokidar hopefully getting triggered earlier than this. May have to be increased for slow local drives but then one has to watch out not to actually change the same file within a period shorter than this.
const RECENT_LOCAL_TIMEOUT = 500;

async function main() {
  setUpTrayIcon();

  // Ensure the local sync directory exists
  fs.mkdir(LOCAL_DIR, { recursive: true });
  await biDirectionalSync();

  async function downloadFile(key: string) {
    if (recentUploads.has(key)) {
      logger.info(`Skipping download for file recently uploaded to S3: ${key}`);
      return;
    }

    try {
      recentDownloads.add(key);
      logger.debug(`downloadFile: added ${key} to recent downloads`);
      changeTrayIconState(TrayIconState.Busy);

      const fullPath = join(LOCAL_DIR, key);
      await download(key, fullPath);
      const { size } = await stat(fullPath);
      trackFileOperation(key, size);

      changeTrayIconState(TrayIconState.Idle);
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
      changeTrayIconState(TrayIconState.Busy);

      await fs.unlink(join(LOCAL_DIR, key));
      trackFileOperation(key);
      logger.info(`Removed local file: ${key}`);

      changeTrayIconState(TrayIconState.Idle);
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
      changeTrayIconState(TrayIconState.Busy);

      await deleteObject(key);
      trackFileOperation(key);

      changeTrayIconState(TrayIconState.Idle);
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
      changeTrayIconState(TrayIconState.Busy);

      await upload(localPath, key);
      const { size } = await stat(localPath);
      trackFileOperation(key, size);

      changeTrayIconState(TrayIconState.Idle);
      setTimeout(() => {
        recentUploads.delete(key);
        logger.debug(`syncFile: removed ${localPath} from recent uploads`);
      }, RECENT_REMOTE_TIMEOUT);
    } catch (error) {
      recentUploads.delete(key);
      logger.error(`Error uploading file ${key}:`, error);
    }
  }

  setUpFileWatcher(syncFile, removeFile);
  setUpWebsocket(downloadFile, removeLocalFile);
}

main();
