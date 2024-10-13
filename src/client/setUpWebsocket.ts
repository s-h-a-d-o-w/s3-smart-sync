import { SNSMessage, S3Event } from "aws-lambda";
import { updateTrayIconImage, updateTrayTooltip } from "node-tray";
import { logger } from "../utils/logger";
import { WEBSOCKET_URL, RECONNECT_DELAY } from "./consts";
import WebSocket from "ws";

type RemoteToLocalOperation = (key: string) => void;

export function setUpWebsocket(
  downloadFile: RemoteToLocalOperation,
  removeLocalFile: RemoteToLocalOperation,
) {
  const ws = new WebSocket(WEBSOCKET_URL);

  ws.on("open", () => {
    logger.info(`Connected to ${WEBSOCKET_URL}`);
    updateTrayIconImage("./assets/icon.ico");
    updateTrayTooltip("S3 Smart Sync");
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
      logger.error("Error processing WebSocket message: ", error);
    }
  });

  ws.on("close", () => {
    logger.info("Disconnected from WebSocket server");
    updateTrayIconImage("./assets/icon_disconnected.ico");
    updateTrayTooltip("S3 Smart Sync (Disconnected)");
    setTimeout(setUpWebsocket, parseInt(RECONNECT_DELAY, 10));
  });
}
