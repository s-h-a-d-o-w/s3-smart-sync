import "dotenv/config";

import express from "express";
import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import bodyParser from "body-parser";
import { ConfirmSubscriptionCommand, SNSClient } from "@aws-sdk/client-sns";
import type { S3Event, SNSMessage } from "aws-lambda";
import { getEnvironmentVariables } from "@s3-smart-sync/shared/getEnvironmentVariables.ts";
import { getHeartbeatInterval } from "@s3-smart-sync/shared/getHeartbeatInterval.ts";
import { logger } from "@s3-smart-sync/shared/logger.ts";
import { promisify } from "node:util";
import MessageValidator from "sns-validator";

const validator = new MessageValidator();
const validate = promisify(validator.validate.bind(validator));

type ExtendedWebSocket = { isAlive?: boolean } & WebSocket;

const HEARTBEAT_INTERVAL = getHeartbeatInterval();
const { AWS_REGION, ACCESS_KEY, SECRET_KEY, WEBSOCKET_TOKEN } =
  getEnvironmentVariables(
    "AWS_REGION",
    "ACCESS_KEY",
    "SECRET_KEY",
    "WEBSOCKET_TOKEN",
  );

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const snsClient = new SNSClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});

const clients = new Map<WebSocket, string>();

app.use(
  bodyParser.json({
    type: ["text/plain", "application/json"],
  }),
);

app.get("/", (_, res) => {
  res.status(200).send("Running.");
});

app.post("/sns", async (req, res) => {
  if (process.env["NODE_ENV"] === "production") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await validate(req.body);
    } catch (error) {
      logger.error("Invalid SNS message:", error);
      res.sendStatus(400);
      return;
    }
  }

  try {
    const snsMessage = req.body as SNSMessage;
    if (snsMessage.Type === "SubscriptionConfirmation") {
      try {
        const command = new ConfirmSubscriptionCommand({
          TopicArn: snsMessage.TopicArn,
          Token: snsMessage.Token,
        });
        await snsClient.send(command);
        logger.info("SNS subscription confirmed");
      } catch (error) {
        logger.error("Error confirming SNS subscription:", error);
      }
    } else if (snsMessage.Type === "Notification") {
      logger.debug(
        `Received message: ${JSON.stringify(snsMessage, undefined, 2)}`,
      );
      // logger.info(
      //   `Will forward a ${message.Type} to ${clients.size} clients.`,
      // );
      const s3Event = JSON.parse(snsMessage.Message) as S3Event;

      clients.forEach((bucket, client) => {
        if (client.readyState !== WebSocket.OPEN) {
          return;
        }

        const filteredRecords = s3Event.Records.filter(
          (record) => record.s3.bucket.name === bucket,
        );
        if (filteredRecords.length === 0) {
          logger.debug(
            `No records for bucket "${bucket}". Not forwarding to this client.`,
          );
          return;
        }

        client.send(
          JSON.stringify({
            ...snsMessage,
            Message: JSON.stringify({ ...s3Event, Records: filteredRecords }),
          }),
        );
      });
    } else {
      clients.forEach((_, client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(snsMessage));
        }
      });
    }
  } catch (error) {
    logger.error("Error processing SNS message:", error);
    res.sendStatus(500);
    return;
  }

  res.sendStatus(200);
});

wss.on("connection", (client: ExtendedWebSocket, request) => {
  const parameters = new URLSearchParams(request.url?.split("?")[1] ?? "");
  const token = parameters.get("token");
  const bucket = parameters.get("bucket");

  if (token !== WEBSOCKET_TOKEN) {
    logger.warn("Unauthorized WebSocket connection attempt");
    client.close(1008, "Unauthorized");
    return;
  }

  if (!bucket) {
    logger.warn("WebSocket connection attempt without bucket name");
    client.close(1008, "Missing bucket name");
    return;
  }

  client.isAlive = true;
  client.on("pong", () => {
    client.isAlive = true;
  });

  clients.set(client, bucket);
  logger.info(
    `New WebSocket client connected for bucket "${bucket}". (Number of clients: ${clients.size})`,
  );

  client.on("close", () => {
    clients.delete(client);
    logger.info(
      `WebSocket client disconnected. (Number of clients: ${clients.size})`,
    );
  });
});

setInterval(function ping() {
  wss.clients.forEach(function each(client: ExtendedWebSocket) {
    if (client.isAlive === false) {
      return client.terminate();
    }

    client.isAlive = false;
    client.ping();
  });
}, HEARTBEAT_INTERVAL);

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM signal, shutting down...");
  // Delay exit to allow logs to flush
  setTimeout(() => process.exit(0), 100);
});

process.on("SIGINT", () => {
  logger.info("Received SIGINT signal, shutting down...");
  // Delay exit to allow logs to flush
  setTimeout(() => process.exit(0), 100);
});

server.listen(process.env["PORT"] ?? 80, () => {
  logger.info(`Server is running on port ${process.env["PORT"] ?? 80}.`);
});
