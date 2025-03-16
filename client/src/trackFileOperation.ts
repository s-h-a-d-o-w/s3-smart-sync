import { logger } from "@s3-smart-sync/shared/logger.js";
import { destroyTrayIcon } from "./trayWrapper.js";

const MAX_NUMBER_OF_OPERATIONS = 10;
const LONG_OBSERVATION_DURATION = 10000;

const fileOperations: Record<string, [number, number | undefined][]> = {}; // <S3 key, [timestamp, size?][]>
const cleanupTimers: Record<string, NodeJS.Timeout | undefined> = {};

export function cleanupFileOperationsTimers() {
  Object.values(cleanupTimers).forEach((timer) => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Shuts down the client if an unusually high amount of operations on the same file within a short-time frame must detected, hinting at a possible infinite loop.
 *
 * @param key S3 key
 */
export function trackFileOperation(key: string, size?: number) {
  if (!fileOperations[key]) {
    fileOperations[key] = [];
  }
  fileOperations[key].push([Date.now(), size]);

  // >5 ops within 10 sec. (since local ops are debounced with 500 ms)
  const hasTooManyRecentOperations =
    fileOperations[key].length > MAX_NUMBER_OF_OPERATIONS &&
    Date.now() - (fileOperations[key].at(-1)?.[0] || 0) <
      LONG_OBSERVATION_DURATION;

  const uniqueSizes = new Set(
    fileOperations[key].filter(([, _size]) => _size !== undefined),
  );
  const hasReasonableAmountOfSizeChanges =
    uniqueSizes.size / fileOperations[key].length > 0.25;

  if (hasTooManyRecentOperations && !hasReasonableAmountOfSizeChanges) {
    // TODO: If this ever actually happens, it would be worthwhile considering to instead drop the websocket connection for half a minute or so, re-establish it and only if the problem doesn't disappear even after a few reconnect cycles like that, kill the client.
    logger.error(
      `Unusually high amount of operations on ${key} detected:\n${fileOperations[
        key
      ]
        .map(
          ([timestamp, size]) =>
            `${new Date(timestamp).toISOString()}: ${size} Bytes`,
        )
        .join("\n")}\nExiting...`,
    );
    destroyTrayIcon();
    process.exit(1);
  }

  // Schedule cleanup
  if (!cleanupTimers[key]) {
    cleanupTimers[key] = setTimeout(() => {
      cleanupTimers[key] = undefined;
      if (fileOperations[key]) {
        const beforeObservedWindow =
          Date.now() - (LONG_OBSERVATION_DURATION + 1000);
        fileOperations[key] = fileOperations[key].filter(
          ([timestamp]) => timestamp > beforeObservedWindow,
        );
      }
    }, 61 * 1000);
  }
}
