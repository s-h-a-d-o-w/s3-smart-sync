import "dotenv/config";

import { mkdir, stat, unlink } from "fs/promises";
import { join } from "path";
import { logger } from "../utils/logger.js";
import { LOCAL_DIR } from "./consts.js";
import {
  convertAbsolutePathToKey,
  deleteObject,
  download,
  getLastModified,
  upload,
  upToDate,
} from "./s3Operations.js";
import { setUpFileWatcher } from "./setUpFileWatcher.js";
import { setUpWebsocket } from "./setUpWebsocket.js";
import { trackFileOperation } from "./trackFileOperation.js";
import {
  changeTrayIconState,
  setUpTrayIcon,
  TrayIconState,
} from "./setUpTrayIcon.js";
import { fileExists } from "../utils/fileExists.js";
import { getErrorMessage } from "../utils/getErrorMessage.js";

async function main() {
  await setUpTrayIcon();

  // Ensure the local sync directory exists
  await mkdir(LOCAL_DIR, { recursive: true });

  async function downloadFile(key: string) {
    const fullPath = join(LOCAL_DIR, key);
    if (await upToDate(key)) {
      logger.debug(`downloadFile: Already up to date: ${fullPath}`);
      return;
    }

    try {
      changeTrayIconState(TrayIconState.Busy);

      await download(key, fullPath);
      const { size } = await stat(fullPath);
      trackFileOperation(key, size);
    } catch (error) {
      logger.error(`Error downloading file ${key}: ${getErrorMessage(error)}`);
    } finally {
      changeTrayIconState(TrayIconState.Idle);
    }
  }

  async function removeLocalFile(key: string) {
    const fullPath = join(LOCAL_DIR, key);
    if (!(await fileExists(fullPath))) {
      logger.debug(`removeLocalFile: Doesn't exist: ${fullPath}`);
      return;
    }

    try {
      changeTrayIconState(TrayIconState.Busy);

      await unlink(fullPath);
      trackFileOperation(key);
      logger.info(`Removed local file: ${key}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.error(
          `Error removing local file ${key}: ${getErrorMessage(error)}`,
        );
      } else {
        logger.info(`File ${key} already removed or doesn't exist.`);
      }
    } finally {
      changeTrayIconState(TrayIconState.Idle);
    }
  }

  async function removeFile(localPath: string) {
    const key = convertAbsolutePathToKey(localPath);
    try {
      await getLastModified(key);
    } catch (_) {
      logger.debug(`removeFile: Doesn't exist: ${key}`);
      return;
    }

    try {
      changeTrayIconState(TrayIconState.Busy);

      await deleteObject(key);
      trackFileOperation(key);
    } catch (error) {
      logger.error(
        `Error deleting file ${key} from S3: ${getErrorMessage(error)}`,
      );
    } finally {
      changeTrayIconState(TrayIconState.Idle);
    }
  }

  async function syncFile(localPath: string) {
    const key = convertAbsolutePathToKey(localPath);

    try {
      if (await upToDate(key)) {
        logger.debug(`syncFile: Already up to date: ${key}`);
        return;
      }
    } catch (_) {
      // File doesn't exist on S3
    }

    try {
      changeTrayIconState(TrayIconState.Busy);

      await upload(localPath, key);
      const { size } = await stat(localPath);
      trackFileOperation(key, size);
    } catch (error) {
      logger.error(`Error uploading file ${key}: ${getErrorMessage(error)}`);
    } finally {
      changeTrayIconState(TrayIconState.Idle);
    }
  }

  // Ensure that initial syncing happened BEFORE we start to watch local file changes.
  await setUpWebsocket(downloadFile, removeLocalFile);
  setUpFileWatcher(syncFile, removeFile);
}

void main();
