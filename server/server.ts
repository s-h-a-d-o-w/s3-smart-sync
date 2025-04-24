import "dotenv/config";

import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import bodyParser from "body-parser";
import { ConfirmSubscriptionCommand, SNSClient } from "@aws-sdk/client-sns";
import type { SNSMessage } from "aws-lambda";
import { getEnvironmentVariables } from "@s3-smart-sync/shared/getEnvironmentVariables.ts";
import { getHeartbeatInterval } from "@s3-smart-sync/shared/getHeartbeatInterval.ts";
import { logger } from "@s3-smart-sync/shared/logger.ts";
import { promisify } from "util";
import MessageValidator from "sns-validator";

const validator = new MessageValidator();
const validate = promisify(validator.validate.bind(validator));

interface ExtendedWebSocket extends WebSocket {
  isAlive?: boolean;
}

const HEARTBEAT_INTERVAL = getHeartbeatInterval();
const { AWS_REGION, ACCESS_KEY, SECRET_KEY } = getEnvironmentVariables(
  "AWS_REGION",
  "ACCESS_KEY",
  "SECRET_KEY",
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

const clients = new Set<WebSocket>();

app.use(
  bodyParser.json({
    type: ["text/plain", "application/json"],
  }),
);

app.get("/", (_, res) => {
  res.status(200).send("Running.");
});

app.post("/sns", async (req, res) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await validate(req.body);
  } catch (error) {
    logger.error("Invalid SNS message:", error);
    res.sendStatus(400);
    return;
  }

  try {
    const message = req.body as SNSMessage;
    if (message.Type === "SubscriptionConfirmation") {
      try {
        const command = new ConfirmSubscriptionCommand({
          TopicArn: message.TopicArn,
          Token: message.Token,
        });
        await snsClient.send(command);
        logger.info("SNS subscription confirmed");
      } catch (error) {
        logger.error("Error confirming SNS subscription:", error);
      }
    } else {
      // logger.info(`Received message: ${JSON.stringify(message, null, 2)}`);
      // logger.info(
      //   `Will forward a ${message.Type} to ${clients.size} clients.`,
      // );
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(message));
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

wss.on("connection", (client: ExtendedWebSocket) => {
  client.isAlive = true;
  client.on("pong", () => {
    client.isAlive = true;
  });

  clients.add(client);
  logger.info(
    `New WebSocket client connected. (Number of clients: ${clients.size})`,
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
    if (client.isAlive === false) return client.terminate();

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
