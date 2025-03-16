import type { S3Event, SNSMessage } from "aws-lambda";
import WebSocket from "ws";
import { getErrorMessage } from "@s3-smart-sync/shared/getErrorMessage.js";
import { logger } from "@s3-smart-sync/shared/logger.js";
import { biDirectionalSync } from "./biDirectionalSync.js";
import { RECONNECT_DELAY, WEBSOCKET_URL } from "./consts.js";
import {
  resetIgnoreMaps,
  resumeFileWatcher,
  suspendFileWatcher,
} from "./fileWatcher.js";
import { changeTrayIconState, TrayIconState } from "./trayIcon.js";
import { updateTrayTooltip } from "./trayWrapper.js";
import { getHeartbeatInterval } from "@s3-smart-sync/shared/getHeartbeatInterval.js";

type RemoteToLocalOperation = (key: string) => void;

// Storing the websocket globally makes it possible for the garbage collector to clean up unused ones when many reconnect attempts happen.
let ws: WebSocket | undefined;
let logError = true;
let isShuttingDown = false;
let connectionDropTimeout: NodeJS.Timeout | undefined;

function connectionDropCheck() {
  clearTimeout(connectionDropTimeout);
  connectionDropTimeout = setTimeout(() => {
    ws?.terminate();
  }, getHeartbeatInterval() * 3);
}

export function cleanupWebsocket() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  clearTimeout(connectionDropTimeout);

  if (ws) {
    return new Promise<void>((resolve) => {
      ws?.removeAllListeners();

      const forceCloseTimeout = setTimeout(() => {
        logger.info("Force terminating WebSocket");
        ws?.terminate();
      }, 1000);

      ws?.once("close", () => {
        clearTimeout(forceCloseTimeout);
        ws = undefined;
        resolve();
      });

      ws?.close();
    });
  }
}

export function setUpWebsocket(
  downloadFile: RemoteToLocalOperation,
  removeLocalFile: RemoteToLocalOperation,
) {
  return new Promise<void>((resolve) => {
    if (ws) {
      ws.close();
    }

    ws = new WebSocket(WEBSOCKET_URL);

    connectionDropCheck();

    ws.on("ping", connectionDropCheck);

    ws.on("open", () => {
      connectionDropCheck();
      logger.info(`Connected to ${WEBSOCKET_URL}`);
      logError = true;
      updateTrayTooltip("S3 Smart Sync");
      changeTrayIconState(TrayIconState.Busy);

      // Although we have the promise for the initial file watcher creation, we have to suspend here in case of reconnects.
      suspendFileWatcher();
      // We don't await this so that pongs can be sent during sync.
      biDirectionalSync()
        .then(() => {
          /* empty */
        })
        .catch((error) => {
          logger.error(`Error during initial sync: ${getErrorMessage(error)}`);
        })
        .finally(() => {
          changeTrayIconState(TrayIconState.Idle);
          resumeFileWatcher();
          resolve();
        });
    });

    ws.on("message", (data) => {
      if (!(data instanceof Buffer)) {
        logger.error("Only messages of type `Buffer` are supported.");
        return;
      }

      try {
        const message = JSON.parse(data.toString()) as SNSMessage;
        if (message.Type === "Notification") {
          const snsMessage = JSON.parse(message.Message) as S3Event;

          for (const record of snsMessage.Records) {
            const key = decodeURIComponent(
              record.s3.object.key.replace(/\+/g, " "),
            );

            if (record.eventName.startsWith("ObjectCreated:")) {
              downloadFile(key);
            } else if (record.eventName.startsWith("ObjectRemoved:")) {
              removeLocalFile(key);
            } else {
              throw new Error(
                "Received invalid record: " + JSON.stringify(record),
              );
            }
          }
        } else {
          throw new Error(
            "Received invalid message: " + JSON.stringify(message),
          );
        }
      } catch (error) {
        logger.error(
          `Error processing WebSocket message: ${getErrorMessage(error)}`,
        );
      }
    });

    ws.on("error", function error(err) {
      if (logError) {
        logError = false;
        logger.error(
          `Error connecting WebSocket: "${err.message}". We will keep retrying but not log any more errors until there has been a successful connection or client restart.`,
        );
      }
    });

    ws.on("close", () => {
      if (isShuttingDown) {
        return;
      }

      logger.error("Disconnected from WebSocket server");
      changeTrayIconState(TrayIconState.Disconnected);
      updateTrayTooltip("S3 Smart Sync (Disconnected)");
      resetIgnoreMaps();
      setTimeout(
        setUpWebsocket,
        RECONNECT_DELAY,
        downloadFile,
        removeLocalFile,
      );
    });
  });
}
