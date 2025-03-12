import { ChildProcess } from "child_process";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { logger } from "@s3-smart-sync/shared/logger.js";
import { spawn } from "child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path, { join } from "node:path";
import {
  ACCESS_KEY,
  AWS_REGION,
  S3_BUCKET,
  SECRET_KEY,
} from "../src/consts.js";

const SERVER_URL = process.env["WEBSOCKET_URL"]!.replace("ws", "http");

const clients: Record<number, ChildProcess> = {};
export const clientLogs: Record<number, string> = {};
let serverProcess: ChildProcess | undefined;

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});

export async function cleanupLocalDirectories() {
  const testClientDirectories = (await readdir(__dirname)).filter((file) =>
    file.startsWith("test-client-"),
  );
  await Promise.all(
    testClientDirectories.map((directory) =>
      rm(join(__dirname, directory), { recursive: true, force: true }),
    ),
  );
}

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

/**
 * Includes sending SNS message
 */
export async function createDirectory(id: number, key: `${string}/`) {
  await createFile(id, key, "");
}

/**
 * Includes sending SNS message
 */
export async function createFile(id: number, key: string, content: string) {
  const clientDirectory = join(__dirname, `test-client-${id}`);
  if (key.endsWith("/")) {
    await mkdir(join(clientDirectory, key), { recursive: true });
  } else {
    await mkdir(path.dirname(join(clientDirectory, key)), { recursive: true });
    await writeFile(join(clientDirectory, key), content);
  }

  let lastModified: Date | undefined;
  await waitUntil(async () => {
    const { Body, LastModified } = await s3Client.send(
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      }),
    );
    lastModified = LastModified;

    // We have to check content in case the file already existed
    const actualContent = await Body?.transformToString();
    return actualContent === content;
  });

  // Wait for modified timestamp syncing
  if (lastModified) {
    await waitUntil(async () => {
      return (
        (await stat(join(clientDirectory, key))).mtime.valueOf() ===
        lastModified!.valueOf()
      );
    });
  } else {
    throw new Error("No last modified info for " + key);
  }

  await sendSnsMessage(key, "put");
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

export function list(prefix: string) {
  return s3Client.send(
    new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: prefix,
    }),
  );
}

export function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function startClients(ids: readonly number[]) {
  await Promise.all(
    ids.map(async (id) => {
      const clientDirectory = join(__dirname, `test-client-${id}`);

      const clientProcess = spawn(
        "node",
        [path.join(__dirname, "../dist/index.cjs"), "cli"],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, LOCAL_DIR: clientDirectory },
        },
      );

      clients[id] = clientProcess;
      clientProcess.on("exit", () => {
        delete clients[id];
      });

      if (!clientLogs[id]) {
        clientLogs[id] = "";
      }

      const colorCode = 31 + (id % 6); // Colors from 31-36 (red, green, yellow, blue, magenta, cyan)
      function processBuffer(data: Buffer, stream: "stdout" | "stderr") {
        data
          .toString()
          .trim()
          .split("\n")
          .forEach((line) => {
            process[stream].write(`\x1b[${colorCode}m[${id}]\x1b[0m ${line}\n`);
            clientLogs[id] += line + "\n";
          });
      }
      clientProcess.stdout?.on("data", (data: Buffer) => {
        processBuffer(data, "stdout");
      });
      clientProcess.stderr?.on("data", (data: Buffer) => {
        processBuffer(data, "stderr");
      });

      await waitUntil(() => {
        return clientLogs[id]
          ?.trim()
          .endsWith(`Watching for changes in ${clientDirectory}`);
      });

      // Despite waiting for the log output, it seems like the client might still not be fully ready. (Flaky tests)
      await pause(200);
    }),
  );
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

export async function stopClients(ids?: readonly number[]) {
  await Promise.all(
    (ids || Object.keys(clients).map(Number)).map(async (id) => {
      await killProcess(clients[id]);
      delete clients[id];
    }),
  );
}

export async function stopServer() {
  await killProcess(serverProcess);
  serverProcess = undefined;
}

export async function upload(key: string, body?: string) {
  await new Upload({
    client: s3Client,
    params: {
      Bucket: S3_BUCKET,
      Key: key,
      Body: key.endsWith("/") ? "" : body || "",
    },
  }).done();
}

export async function waitUntil(
  fn: () => unknown,
  {
    interval = 200,
    timeout = 5000,
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

export async function waitForEmptyDirectories() {
  await waitUntil(async () => {
    for (const id of Object.keys(clients)) {
      if ((await readdir(join(__dirname, `test-client-${id}`))).length > 0) {
        return false;
      }
    }

    return true;
  });
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms?: number,
): Promise<T> {
  const timeout = ms || 1000;
  const timeoutError = new Error(`Operation timed out after ${timeout} ms`);
  return await Promise.race([
    promise,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    new Promise((_, reject) =>
      setTimeout(() => reject(timeoutError), timeout),
    ) as Promise<T>,
  ]);
}
