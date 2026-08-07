import { logger } from "@s3-smart-sync/shared/logger.ts";
import { cleanupFileWatcher } from "./fileWatcher.ts";
import { cleanupWebsocket } from "./setUpWebsocket.ts";
import { cleanupFileOperationsTimers } from "./trackFileOperation.ts";
import { destroyTrayIcon } from "./trayWrapper.ts";

export async function shutdown() {
  logger.info("Shutting down...");
  destroyTrayIcon();
  cleanupFileOperationsTimers();
  await cleanupWebsocket();
  await cleanupFileWatcher();
}
