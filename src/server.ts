import "dotenv/config";

import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import bodyParser from "body-parser";
import { ConfirmSubscriptionCommand, SNSClient } from "@aws-sdk/client-sns";
import type { SNSMessage } from "aws-lambda";
import { getEnvironmentVariables } from "./getEnvironmentVariables.js";
import { getHeartbeatInterval } from "./utils/getHeartbeatInterval.js";
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

// Store connected WebSocket clients
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
  const message = req.body as SNSMessage;

  try {
    if (message.Type === "SubscriptionConfirmation") {
      try {
        const command = new ConfirmSubscriptionCommand({
          TopicArn: message.TopicArn,
          Token: message.Token,
        });
        await snsClient.send(command);
        console.log("SNS subscription confirmed");
      } catch (error) {
        console.error("Error confirming SNS subscription:", error);
      }
    } else {
      // console.log(`Will forward a ${message.Type} to ${clients.size} clients.`);
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(message));
        }
      });
    }
  } catch (_) {
    console.error("Received a non-SNS request.");
    res.sendStatus(400);
    return;
  }

  res.sendStatus(200);
});

// WebSocket connection handler
wss.on("connection", (client: ExtendedWebSocket) => {
  client.isAlive = true;
  client.on("pong", () => {
    client.isAlive = true;
  });

  clients.add(client);
  console.log(
    `New WebSocket client connected. (Number of clients: ${clients.size})`,
  );

  client.on("close", () => {
    console.log(
      `WebSocket client disconnected. (Number of clients: ${clients.size})`,
    );
    clients.delete(client);
  });
});

setInterval(function ping() {
  wss.clients.forEach(function each(client: ExtendedWebSocket) {
    if (client.isAlive === false) return client.terminate();

    client.isAlive = false;
    client.ping();
  });
}, HEARTBEAT_INTERVAL);

server.listen(80, () => {
  console.log(`Server is running.`);
});
