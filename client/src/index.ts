import "dotenv/config";
import "./globalErrorHandling.js";

import { mkdir, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "@s3-smart-sync/shared/logger.js";
import { LOCAL_DIR, IS_CLI, RELEASE_URL } from "./consts.js";
import {
  convertAbsolutePathToKey,
  deleteObject,
  download,
  getLastModified,
  upload,
  upToDate,
} from "./s3Operations.js";
import {
  cleanupFileWatcher,
  FileOperationType,
  ignore,
  setUpFileWatcher,
  unignore,
} from "./fileWatcher.js";
import { cleanupWebsocket, setUpWebsocket } from "./setUpWebsocket.js";
import {
  cleanupFileOperationsTimers,
  trackFileOperation,
} from "./trackFileOperation.js";
import {
  changeTrayIconState,
  setUpTrayIcon,
  TrayIconState,
} from "./trayIcon.js";
import { fileExists } from "@s3-smart-sync/shared/fileExists.js";
import { getErrorMessage } from "@s3-smart-sync/shared/getErrorMessage.js";
import { destroyTrayIcon } from "./trayWrapper.js";
import { getUpdateVersion } from "./getUpdateVersion.js";

export async function shutdown() {
  logger.info("Shutting down...");
  destroyTrayIcon();
  cleanupFileOperationsTimers();
  await cleanupWebsocket();
  await cleanupFileWatcher();
}

async function main() {
  const updateVersion = await getUpdateVersion();
  if (IS_CLI) {
    if (updateVersion) {
      logger.error(`A new version is available: ${updateVersion}`);
      logger.error(`Download at: ${RELEASE_URL}`);
    }
  } else {
    await setUpTrayIcon(updateVersion);
  }

  // Ensure the local sync directory exists
  await mkdir(LOCAL_DIR, { recursive: true });

  async function downloadFile(key: string) {
    logger.info(`downloadFile: ${key}`);
    const localPath = join(LOCAL_DIR, key);
    if (await upToDate(key)) {
      logger.debug(`downloadFile: Already up to date: ${localPath}`);
      return;
    }

    try {
      changeTrayIconState(TrayIconState.Busy);

      ignore(FileOperationType.Sync, localPath);
      await download(key, localPath);
      const { size } = await stat(localPath);
      trackFileOperation(key, size);
    } catch (error) {
      logger.error(`Error downloading file ${key}: ${getErrorMessage(error)}`);
    } finally {
      unignore(FileOperationType.Sync, localPath);
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
      ignore(FileOperationType.Remove, localPath);

      if ((await stat(localPath)).isDirectory()) {
        await rm(localPath, { recursive: true, force: true });
        logger.info(`Removed local directory: ${key}`);
      } else {
        await unlink(localPath);
        logger.info(`Removed local file: ${key}`);
      }

      trackFileOperation(key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.info(`File ${key} already removed or doesn't exist.`);
      } else {
        logger.error(
          `Error removing local file ${key}: ${getErrorMessage(error)}`,
        );
      }
    } finally {
      unignore(FileOperationType.Remove, localPath);
      changeTrayIconState(TrayIconState.Idle);
    }
  }

  async function removeFile(localPath: string) {
    const preliminaryKey = await convertAbsolutePathToKey(localPath);

    // Because the file was already deleted locally, we don't know whether it was a directory
    // (We could pass through the info from chokidar but that would be messy architecturally)
    let isDirectory: boolean | undefined;
    try {
      await getLastModified(preliminaryKey + "/");
      isDirectory = true;
    } catch (_) {
      // empty
    }

    if (!isDirectory) {
      try {
        await getLastModified(preliminaryKey);
      } catch (_) {
        logger.debug(`removeFile: Doesn't exist: ${preliminaryKey}`);
        return;
      }
    }

    const key = isDirectory ? preliminaryKey + "/" : preliminaryKey;
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
    const key = await convertAbsolutePathToKey(localPath);

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
