import type { S3Event, SNSMessage } from "aws-lambda";
import WebSocket from "ws";
import { getErrorMessage } from "../utils/getErrorMessage.js";
import { logger } from "../utils/logger.js";
import { biDirectionalSync } from "./biDirectionalSync.js";
import { RECONNECT_DELAY, WEBSOCKET_URL } from "./consts.js";
import { resumeFileWatcher, suspendFileWatcher } from "./fileWatcher.js";
import { changeTrayIconState, TrayIconState } from "./trayIcon.js";
import { updateTrayTooltip } from "./trayWrapper.js";

type RemoteToLocalOperation = (key: string) => void;

// Storing the websocket globally makes it possible for the garbage collector to clean up unused ones when reconnects happen.
let ws: WebSocket | undefined;
let logError = true;

export function setUpWebsocket(
  downloadFile: RemoteToLocalOperation,
  removeLocalFile: RemoteToLocalOperation,
) {
  return new Promise<void>((resolve) => {
    if (ws) {
      ws.close();
    }

    ws = new WebSocket(WEBSOCKET_URL);

    ws.on("open", async () => {
      logger.info(`Connected to ${WEBSOCKET_URL}`);
      logError = true;
      updateTrayTooltip("S3 Smart Sync");
      changeTrayIconState(TrayIconState.Busy);

      // Although we have the promise for the initial file watcher creation, we have to suspend here in case of reconnects.
      suspendFileWatcher();
      await biDirectionalSync();
      resumeFileWatcher();

      changeTrayIconState(TrayIconState.Idle);
      resolve();
    });

    ws.on("message", (data) => {
      if (!(data instanceof Buffer)) {
        throw new Error("Only messages of type `Buffer` are supported.");
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
      logger.info("Disconnected from WebSocket server");
      changeTrayIconState(TrayIconState.Disconnected);
      updateTrayTooltip("S3 Smart Sync (Disconnected)");
      setTimeout(
        setUpWebsocket,
        RECONNECT_DELAY,
        downloadFile,
        removeLocalFile,
      );
    });
  });
}
