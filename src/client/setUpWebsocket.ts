import type { S3Event, SNSMessage } from "aws-lambda";
import { updateTrayTooltip } from "node-tray";
import WebSocket from "ws";
import { getErrorMessage } from "../utils/getErrorMessage.js";
import { logger } from "../utils/logger.js";
import { biDirectionalSync } from "./biDirectionalSync.js";
import { RECONNECT_DELAY, WEBSOCKET_URL } from "./consts.js";
import { resumeFileWatcher, suspendFileWatcher } from "./setUpFileWatcher.js";
import { changeTrayIconState, TrayIconState } from "./setUpTrayIcon.js";

type RemoteToLocalOperation = (key: string) => void;

// Storing the websocket globally makes it possible for the garbage collector to clean up unused ones when reconnects happen.
let ws: WebSocket | undefined;

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
      updateTrayTooltip("S3 Smart Sync");
      changeTrayIconState(TrayIconState.Busy);

      // Although we have the promise for the initial file watcher creation, we have to suspend here in case of reconnects.
      suspendFileWatcher();
      await biDirectionalSync();
      resumeFileWatcher();

      changeTrayIconState(TrayIconState.Idle);
      resolve();
    });

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString()) as SNSMessage;
        if (message.Type === "Notification") {
          const snsMessage = JSON.parse(message.Message) as S3Event;

          for (const record of snsMessage.Records) {
            const key = decodeURIComponent(
              record.s3.object.key.replace(/\+/g, " "),
            );

            if (record.eventName.startsWith("ObjectCreated:")) {
              await downloadFile(key);
            } else if (record.eventName.startsWith("ObjectRemoved:")) {
              await removeLocalFile(key);
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
      logger.error(`Error connecting WebSocket: "${err.message}"`);
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
