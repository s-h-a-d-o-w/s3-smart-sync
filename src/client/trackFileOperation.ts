import { logger } from "../utils/logger.js";

const fileOperations: Record<string, number[]> = {}; // <S3 key, timestamp[]>

/**
 * Shuts down the client if an unusually high amount of operations on the same file within a short-time frame must detected, hinting at a possible infinite loop.
 *
 * @param key S3 key
 */
export function trackFileOperation(key: string) {
  if (!(key in fileOperations)) {
    fileOperations[key] = [];
  }
  fileOperations[key].push(Date.now());

  // >5 ops within 1 sec. OR
  // >10 ops within 10 sec.
  if (
    (fileOperations[key].length > 5 &&
      Date.now() - (fileOperations[key].at(-5) || 0) < 1000) ||
    (fileOperations[key].length > 10 &&
      Date.now() - (fileOperations[key].at(-10) || 0) < 10000)
  ) {
    // TODO: If this ever actually happens, it would be worthwhile considering to instead drop the websocket connection for half a minute or so, re-establish it and only if the problem doesn't disappear even after a few reconnect cycles like that, kill the client.
    logger.error(
      `Unusually high amount of operations (more than 5 per second) on ${key} detected. Exiting...`,
    );
    process.exit(1);
  }

  // Keep last 9, in case 10th triggers condition above
  if (fileOperations[key].length > 30) {
    fileOperations[key].splice(0, fileOperations[key].length - 9);
  }
}
