import chokidar, { FSWatcher } from "chokidar";
import debounce from "lodash/debounce.js";
import { logger } from "../utils/logger.js";
import { LOCAL_DIR } from "./consts.js";
import { ignoreFiles } from "./state.js";

type LocalToRemoteOperation = (localPath: string) => void;

let watcher: FSWatcher | undefined;

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
}
