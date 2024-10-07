import "dotenv/config";

import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import bodyParser from "body-parser";
import { SNSClient, ConfirmSubscriptionCommand } from "@aws-sdk/client-sns";
import { SNSMessage } from "aws-lambda";

const {
  env: { AWS_REGION, ACCESS_KEY, SECRET_KEY },
} = process;

if (!AWS_REGION || !ACCESS_KEY || !SECRET_KEY) {
  throw new Error("missing environment variable");
}

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

// app.use(bodyParser.json());
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
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(message));
        }
      });
    }
  } catch (error) {
    console.error("Received a non-SNS request.");
    res.sendStatus(400);
    return;
  }

  res.sendStatus(200);
});

// WebSocket connection handler
wss.on("connection", (client) => {
  console.log("New WebSocket client connected");
  clients.add(client);

  client.on("close", () => {
    console.log("WebSocket client disconnected");
    clients.delete(client);
  });
});

server.listen(80, () => {
  console.log(`Server is running.`);
});
