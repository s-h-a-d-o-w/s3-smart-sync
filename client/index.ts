import "dotenv/config";
import "./globalErrorHandling.js";

import { mkdir, stat, unlink } from "fs/promises";
import { join } from "path";
import { logger } from "@s3-smart-sync/shared/logger.js";
import { LOCAL_DIR } from "./consts.js";
import {
  convertAbsolutePathToKey,
  deleteObject,
  download,
  getLastModified,
  upload,
  upToDate,
} from "./s3Operations.js";
import {
  FileOperationType,
  ignoreNext,
  setUpFileWatcher,
  unignoreNext,
} from "./fileWatcher.js";
import { setUpWebsocket } from "./setUpWebsocket.js";
import { trackFileOperation } from "./trackFileOperation.js";
import {
  changeTrayIconState,
  setUpTrayIcon,
  TrayIconState,
} from "./trayIcon.js";
import { fileExists } from "@s3-smart-sync/shared/fileExists.js";
import { getErrorMessage } from "@s3-smart-sync/shared/getErrorMessage.js";

async function main() {
  await setUpTrayIcon();

  // Ensure the local sync directory exists
  await mkdir(LOCAL_DIR, { recursive: true });

  async function downloadFile(key: string) {
    const localPath = join(LOCAL_DIR, key);
    if (await upToDate(key)) {
      logger.debug(`downloadFile: Already up to date: ${localPath}`);
      return;
    }

    try {
      changeTrayIconState(TrayIconState.Busy);

      await download(key, localPath);
      const { size } = await stat(localPath);
      trackFileOperation(key, size);
    } catch (error) {
      unignoreNext(FileOperationType.Sync, localPath);
      logger.error(`Error downloading file ${key}: ${getErrorMessage(error)}`);
    } finally {
      changeTrayIconState(TrayIconState.Idle);
    }
  }

  async function removeLocalFile(key: string) {
    const localPath = join(LOCAL_DIR, key);
    if (!(await fileExists(localPath))) {
      logger.debug(`removeLocalFile: Doesn't exist: ${localPath}`);
      return;
    }

    try {
      changeTrayIconState(TrayIconState.Busy);

      ignoreNext(FileOperationType.Remove, localPath);
      await unlink(localPath);
      trackFileOperation(key);
      logger.info(`Removed local file: ${key}`);
    } catch (error) {
      unignoreNext(FileOperationType.Remove, localPath);
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
