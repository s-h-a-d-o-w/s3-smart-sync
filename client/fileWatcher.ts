import chokidar, { FSWatcher } from "chokidar";
import debounce from "lodash/debounce.js";
import { logger } from "@s3-smart-sync/shared/logger.js";
import { LOCAL_DIR } from "./consts.js";

type LocalToRemoteOperation = (localPath: string) => void;
export enum FileOperationType {
  Remove,
  Sync,
}

let watcher: FSWatcher | undefined;
const IGNORE_CLEANUP_DURATION = 1000;
const ignoreMaps = {
  [FileOperationType.Remove]: new Map<string, number>(),
  [FileOperationType.Sync]: new Map<string, number>(),
};

export function ignoreNext(fileOperationType: FileOperationType, path: string) {
  ignoreMaps[fileOperationType].set(path, Date.now());
}

export function unignoreNext(
  fileOperationType: FileOperationType,
  path: string,
) {
  ignoreMaps[fileOperationType].set(path, Date.now());
}

function shouldIgnore(fileOperationType: FileOperationType, path: string) {
  const timestamp = ignoreMaps[fileOperationType].get(path);
  if (!timestamp) return false;

  // If the ignore entry is older than 500 ms, it is probably fair to assume that although we handle errors and call unignore(), something unexpected must have happened and this is a stale entry.
  if (Date.now() - timestamp > IGNORE_CLEANUP_DURATION) {
    ignoreMaps[fileOperationType].delete(path);
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
      }, 500);
    }
    return debounceMap[key];
  }

  const wrappedDebouncedSyncFile = (localPath: string) => {
    // Ignore triggers caused by keeping up with S3 state change.
    if (shouldIgnore(FileOperationType.Sync, localPath)) {
      unignoreNext(FileOperationType.Sync, localPath);
      logger.debug(`debouncedSyncFile: ignored once ${localPath}.`);
      return;
    }

    logger.debug(`debouncedSyncFile: triggering syncing ${localPath}.`);
    getDebouncedFunction(FileOperationType.Sync, localPath)();
  };
  const wrappedDebouncedRemoveFile = (localPath: string) => {
    // Ignore triggers caused by keeping up with S3 state change.
    if (shouldIgnore(FileOperationType.Remove, localPath)) {
      unignoreNext(FileOperationType.Remove, localPath);
      logger.debug(`debouncedSyncFile: ignored once ${localPath}.`);
      return;
    }

    logger.debug(`debouncedRemoveFile: triggering removing ${localPath}.`);
    getDebouncedFunction(FileOperationType.Remove, localPath)();
  };

  watcher
    .on("add", wrappedDebouncedSyncFile)
    .on("change", wrappedDebouncedSyncFile)
    .on("unlink", wrappedDebouncedRemoveFile);

  logger.info(`Watching for changes in ${LOCAL_DIR}`);
}
