import type { S3Event, SNSMessage } from "aws-lambda";
import { WebSocket } from "ws";
import { getErrorMessage } from "@s3-smart-sync/shared/getErrorMessage.ts";
import { logger } from "@s3-smart-sync/shared/logger.ts";
import { biDirectionalSync } from "./biDirectionalSync.ts";
import {
  RECONNECT_DELAY,
  S3_BUCKET,
  WEBSOCKET_TOKEN,
  WEBSOCKET_URL,
} from "./consts.ts";
import {
  resetIgnoreMaps,
  resumeFileWatcher,
  suspendFileWatcher,
} from "./fileWatcher.ts";
import { changeTrayIconState, TrayIconState } from "./trayIcon.ts";
import { updateTrayTooltip } from "./trayWrapper.ts";
import { getHeartbeatInterval } from "@s3-smart-sync/shared/getHeartbeatInterval.ts";

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
        // oxlint-disable-next-line promise/no-multiple-resolved
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

    const parameters = new URLSearchParams({
      token: WEBSOCKET_TOKEN,
      bucket: S3_BUCKET,
    });
    ws = new WebSocket(`${WEBSOCKET_URL}?${parameters.toString()}`);

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
        .finally(() => {
          changeTrayIconState(TrayIconState.Idle);
          resumeFileWatcher();
          resolve();
        })
        .catch((error) => {
          logger.error(`Error during initial sync: ${getErrorMessage(error)}`);
        });
    });

    ws.on("message", (data) => {
      if (!(data instanceof Buffer)) {
        logger.error("Only messages of type `Buffer` are supported.");
        return;
      }

      try {
        const snsMessage = JSON.parse(data.toString()) as SNSMessage;
        if (snsMessage.Type === "Notification") {
          const s3Message = JSON.parse(snsMessage.Message) as S3Event;
          logger.info(
            `Received SNS message:\n${JSON.stringify(s3Message, undefined, 2)}`,
          );

          for (const record of s3Message.Records) {
            const {
              eventName,
              s3: {
                object: { key },
              },
            } = record;

            // S3 turns spaces into `+`.
            const decodedKey = key.replaceAll("+", " ");
            if (eventName.startsWith("ObjectCreated:")) {
              downloadFile(decodedKey);
            } else if (eventName.startsWith("ObjectRemoved:")) {
              removeLocalFile(decodedKey);
            } else {
              throw new Error(
                "Received invalid record: " + JSON.stringify(record),
              );
            }
          }
        } else {
          throw new Error(
            "Received invalid message: " + JSON.stringify(snsMessage),
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

      logger.verbose("Disconnected from WebSocket server");
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
