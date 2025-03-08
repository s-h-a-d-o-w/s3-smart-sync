import { ChildProcess } from "child_process";

import { spawn } from "child_process";
import { mkdir, rm, writeFile } from "fs/promises";
import path, { join } from "path";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  ACCESS_KEY,
  AWS_REGION,
  S3_BUCKET,
  SECRET_KEY,
} from "../src/consts.js";
import { logger } from "@s3-smart-sync/shared/logger.js";

const SERVER_URL = process.env["WEBSOCKET_URL"]!.replace("ws", "http");

const clients: Record<number, ChildProcess> = {};
let serverProcess: ChildProcess | undefined;

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});

// Limited to 1000 objects!
export async function cleanupS3() {
  try {
    const { Contents } = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
      }),
    );

    if (!Contents?.length) return;

    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: S3_BUCKET,
        Delete: {
          Objects: Contents.map(({ Key }) => ({ Key })),
        },
      }),
    );
  } catch (error) {
    logger.error(`Failed to cleanup S3 bucket: ${error}`);
  }
}

export async function createClientDirectories<T extends readonly number[]>(
  ids: T,
) {
  return Object.fromEntries(
    await Promise.all(
      ids.map(async (id) => {
        const clientDirectory = join(__dirname, `test-client-${id}`);
        await mkdir(clientDirectory, { recursive: true });
        return [id, clientDirectory] as const;
      }),
    ),
  ) as Record<T[number], string>;
}

export function startClients(ids: number[], debugId?: number) {
  for (const id of ids) {
    const clientDirectory = join(__dirname, `test-client-${id}`);
    const clientProcess = spawn(
      "node",
      [path.join(__dirname, "../dist/index.cjs"), "cli"],
      {
        stdio: id === debugId ? "inherit" : undefined,
        env: { ...process.env, LOCAL_DIR: clientDirectory },
      },
    );
    clients[id] = clientProcess;
  }
}

function killProcess(proc: ChildProcess | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!proc) {
      resolve();
      return;
    }

    proc.once("exit", () => {
      resolve();
    });

    proc.kill("SIGINT");
  });
}

export async function stopClients(ids?: number[]) {
  await Promise.all(
    (ids || Object.keys(clients).map(Number)).map(async (id) => {
      await killProcess(clients[id]);
    }),
  );
}

export async function cleanupLocalDirectories(fully?: boolean) {
  for (const id of Object.keys(clients)) {
    const clientDirectory = join(__dirname, `test-client-${id}`);
    await rm(clientDirectory, { recursive: true, force: true });

    if (!fully) {
      await mkdir(clientDirectory, { recursive: true });
    }
  }
}

export async function createFile(id: number, key: string, content: string) {
  const clientDirectory = join(__dirname, `test-client-${id}`);
  if (key.endsWith("/")) {
    await mkdir(join(clientDirectory, key), { recursive: true });
  } else {
    await mkdir(path.dirname(join(clientDirectory, key)), { recursive: true });
    await writeFile(join(clientDirectory, key), content);
  }

  // We have to check content in case the file already existed
  await waitUntil(async () => {
    if (key.endsWith("/")) {
      await s3Client.send(
        new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
        }),
      );
    } else {
      const { Body } = await s3Client.send(
        new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
        }),
      );
      const actualContent = await Body?.transformToString();
      return actualContent === content;
    }
  });

  await sendSnsMessage(key, "put");
}

export async function sendSnsMessage(key: string, operation: "put" | "delete") {
  const message = {
    Type: "Notification",
    MessageId: "dummy",
    MessageAttributes: {},
    TopicArn: "dummy",
    Message: JSON.stringify({
      Records: [
        {
          eventName:
            operation === "put" ? "ObjectCreated:Put" : "ObjectRemoved:Delete",
          s3: {
            bucket: { name: S3_BUCKET },
            object: { key },
          },
        },
      ],
    }),
    Timestamp: new Date().toISOString(),
    SignatureVersion: "1",
    Signature: "test-signature",
    SigningCertUrl: "test-cert-url",
    UnsubscribeUrl: "test-unsub-url",
  };

  await fetch(SERVER_URL + "/sns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
}

export async function startServer() {
  serverProcess = spawn(
    "node",
    [path.join(__dirname, "../../server/server.js")],
    { env: process.env, stdio: "inherit" },
  );

  await waitUntil(async () => {
    const response = await fetch(SERVER_URL);
    return response.ok && (await response.text()) === "Running.";
  });
}

export async function stopServer() {
  await killProcess(serverProcess);
}

export async function waitUntil(
  fn: () => unknown,
  {
    interval = 200,
    timeout = 3000,
  }: { interval?: number; timeout?: number } = {},
) {
  const startTime = Date.now();

  while (timeout === 0 || Date.now() - startTime < timeout) {
    try {
      // only exceptions or returning false will result in continuation
      if ((await fn()) === false) {
        await pause(interval);
        continue;
      }

      return;
    } catch (_) {
      // continue
    }

    await pause(interval);
  }

  throw new Error("Timeout waiting for condition");
}

export function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
