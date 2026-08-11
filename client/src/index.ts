import "dotenv/config";
import "./globalErrorHandling.ts";

import { mkdir, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { logger } from "@s3-smart-sync/shared/logger.ts";
import { LOCAL_DIR, IS_CLI, RELEASE_URL } from "./consts.ts";
import {
  convertAbsolutePathToKey,
  deleteObject,
  download,
  getLastModified,
  upload,
  upToDate,
} from "./s3Operations.ts";
import {
  FileOperationType,
  ignore,
  setUpFileWatcher,
  unignore,
} from "./fileWatcher.ts";
import { setUpWebsocket } from "./setUpWebsocket.ts";
import { trackFileOperation } from "./trackFileOperation.ts";
import {
  changeTrayIconState,
  setUpTrayIcon,
  TrayIconState,
} from "./trayIcon.ts";
import { fileExists } from "@s3-smart-sync/shared/fileExists.ts";
import { getErrorMessage } from "@s3-smart-sync/shared/getErrorMessage.ts";
import { getUpdateVersion } from "./getUpdateVersion.ts";
import { installService, uninstallService } from "./installService.ts";
import { shutdown } from "./shutdown.ts";

async function downloadFile(key: string) {
  logger.info(`downloadFile: ${key}`);
  const localPath = path.join(LOCAL_DIR, key);
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
  const localPath = path.join(LOCAL_DIR, key);
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
  } catch {
    // empty
  }

  if (!isDirectory) {
    try {
      await getLastModified(preliminaryKey);
    } catch {
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
  } catch {
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

// ========================= MAIN EXECUTION =====================================
if (process.argv.includes("install")) {
  await installService();
  process.exit(0);
}

if (process.argv.includes("uninstall")) {
  await uninstallService();
  process.exit(0);
}

const updateVersion = await getUpdateVersion();
if (IS_CLI) {
  if (updateVersion) {
    logger.error(`A new version is available: ${updateVersion}`);
    logger.error(`Download at: ${RELEASE_URL}`);
  }
} else {
  await setUpTrayIcon(shutdown, updateVersion);
}

// Ensure the local sync directory exists
await mkdir(LOCAL_DIR, { recursive: true });

// Ensure that initial syncing happened BEFORE we start to watch local file changes.
await setUpWebsocket(downloadFile, removeLocalFile);
setUpFileWatcher(syncFile, removeFile);
