import { S3Event, SNSMessage } from "aws-lambda";
import { updateTrayTooltip } from "node-tray";
import WebSocket from "ws";
import { logger } from "../utils/logger";
import { RECONNECT_DELAY, WEBSOCKET_URL } from "./consts";
import { changeTrayIconState, TrayIconState } from "./setUpTrayIcon";
import { getErrorMessage } from "../utils/getErrorMessage";
import { biDirectionalSync } from "./biDirectionalSync";

type RemoteToLocalOperation = (key: string) => void;

export function setUpWebsocket(
  downloadFile: RemoteToLocalOperation,
  removeLocalFile: RemoteToLocalOperation,
) {
  const ws = new WebSocket(WEBSOCKET_URL);

  ws.on("open", async () => {
    logger.info(`Connected to ${WEBSOCKET_URL}`);
    updateTrayTooltip("S3 Smart Sync");
    await biDirectionalSync();
    changeTrayIconState(TrayIconState.Idle);
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
        throw new Error("Received invalid message: " + JSON.stringify(message));
      }
    } catch (error) {
      logger.error(
        `Error processing WebSocket message: ${getErrorMessage(error)}`,
      );
    }
  });

  ws.on("close", () => {
    logger.info("Disconnected from WebSocket server");
    changeTrayIconState(TrayIconState.Disconnected);
    updateTrayTooltip("S3 Smart Sync (Disconnected)");
    setTimeout(setUpWebsocket, parseInt(RECONNECT_DELAY, 10));
  });
}
