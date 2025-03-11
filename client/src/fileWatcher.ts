import chokidar, { FSWatcher } from "chokidar";
import debounce from "lodash/debounce.js";
import { logger } from "@s3-smart-sync/shared/logger.js";
import { LOCAL_DIR } from "./consts.js";
import path from "node:path";

type LocalToRemoteOperation = (localPath: string) => void;
export enum FileOperationType {
  Remove,
  Sync,
}

export const UNIGNORE_DURATION = 200; // short because it only has to cover: end of operation -> file watcher trigger -> ignore that call
export const WATCHER_DEBOUNCE_DURATION = 500;
export const IGNORE_CLEANUP_DURATION = WATCHER_DEBOUNCE_DURATION * 2;

let watcher: FSWatcher | undefined;
const ignoreMaps = {
  [FileOperationType.Remove]: new Map<string, number>(),
  [FileOperationType.Sync]: new Map<string, number>(),
};

export function ignore(fileOperationType: FileOperationType, filePath: string) {
  // Unlike S3, chokidar doesn't use a / at the end of directory paths.
  ignoreMaps[fileOperationType].set(
    filePath.endsWith(path.sep)
      ? filePath.slice(0, -path.sep.length)
      : filePath,
    Date.now(),
  );
}

export function unignore(
  fileOperationType: FileOperationType,
  filePath: string,
) {
  setTimeout(() => {
    ignoreMaps[fileOperationType].delete(filePath);
  }, UNIGNORE_DURATION);
}

function shouldIgnore(fileOperationType: FileOperationType, filePath: string) {
  const timestamp = ignoreMaps[fileOperationType].get(filePath);
  if (!timestamp) return false;

  // If the ignore entry is older than IGNORE_CLEANUP_DURATION, it is probably fair to assume that although we handle errors and call unignore(), something unexpected must have happened and this is a stale entry.
  if (Date.now() - timestamp > IGNORE_CLEANUP_DURATION) {
    ignoreMaps[fileOperationType].delete(filePath);
    return false;
  }

  return true;
}

export function suspendFileWatcher() {
  if (watcher) {
    watcher.unwatch(LOCAL_DIR);
  }
}

export function resumeFileWatcher() {
  if (watcher) {
    watcher.add(LOCAL_DIR);
  }
}

export async function cleanupFileWatcher() {
  if (watcher) {
    await watcher.close();
  }
}

export function setUpFileWatcher(
  syncFile: LocalToRemoteOperation,
  removeFile: LocalToRemoteOperation,
) {
  // Don't use for`awaitWriteFinish` because that would cause conflicts with the RECENT_TIMEOUT. Because that time only starts once writing has finished, potential `add` events during writing are ignored anyway.
  watcher = chokidar.watch(LOCAL_DIR, {
    ignoreInitial: true,
  });

  // Each path gets their own debounced function
  const debounceMap: Record<string, () => void> = {};
  function getDebouncedFunction(
    fileOperationType: FileOperationType,
    localPath: string,
  ): () => void {
    const key = fileOperationType + localPath;
    if (!debounceMap[key]) {
      debounceMap[key] = debounce(() => {
        if (fileOperationType === FileOperationType.Sync) {
          syncFile(localPath);
        } else {
          removeFile(localPath);
        }

        delete debounceMap[key];
      }, WATCHER_DEBOUNCE_DURATION);
    }
    return debounceMap[key];
  }

  const wrappedDebouncedSyncFile = (localPath: string) => {
    if (shouldIgnore(FileOperationType.Sync, localPath)) {
      logger.debug(`wrappedDebouncedSyncFile: ignored ${localPath}.`);
      return;
    }

    logger.debug(`wrappedDebouncedSyncFile: debouncing sync for ${localPath}.`);
    getDebouncedFunction(FileOperationType.Sync, localPath)();
  };
  const wrappedDebouncedRemoveFile = (localPath: string) => {
    if (shouldIgnore(FileOperationType.Remove, localPath)) {
      logger.debug(`wrappedDebouncedRemoveFile: ignored ${localPath}.`);
      return;
    }

    logger.debug(
      `wrappedDebouncedRemoveFile: debouncing removal of ${localPath}.`,
    );
    getDebouncedFunction(FileOperationType.Remove, localPath)();
  };

  watcher
    .on("add", wrappedDebouncedSyncFile)
    .on("addDir", wrappedDebouncedSyncFile)
    .on("change", wrappedDebouncedSyncFile)
    .on("unlink", wrappedDebouncedRemoveFile)
    .on("unlinkDir", wrappedDebouncedRemoveFile);

  logger.info(`Watching for changes in ${LOCAL_DIR}`);
}
