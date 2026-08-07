import { ChildProcess, spawn } from "node:child_process";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { logger } from "@s3-smart-sync/shared/logger.ts";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ACCESS_KEY,
  AWS_REGION,
  S3_BUCKET,
  SECRET_KEY,
} from "../src/consts.ts";

const SERVER_URL = process.env["WEBSOCKET_URL"]!.replace("ws", "http");

// Concurrent CI runs share one bucket, so every run gets its own "subdirectory".
// The clients still use the bucket root, they just sync a directory named after
// this prefix - which is what puts the prefix in front of all of their keys.
export const S3_PREFIX = `test-${randomBytes(8).toString("hex")}/`;

function toPrefixedKey(key: string) {
  return S3_PREFIX + key;
}

function localDirectory(id: number) {
  return path.join(import.meta.dirname, `test-client-${id}`);
}

function syncDirectory(id: number) {
  return path.join(localDirectory(id), S3_PREFIX);
}

const clients = new Map<number, ChildProcess>();
export const clientLogs: Record<number, string> = {};
let serverProcess: ChildProcess | undefined;

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});

export function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntil(
  fn: () => unknown,
  {
    interval = 200,
    timeout = 5000,
  }: { interval?: number; timeout?: number } = {},
) {
  const startTime = Date.now();

  for (;;) {
    if (timeout !== 0 && Date.now() - startTime >= timeout) {
      break;
    }

    try {
      // only exceptions or returning false will result in continuation
      if ((await fn()) === false) {
        await pause(interval);
        continue;
      }

      return;
    } catch {
      // continue
    }

    await pause(interval);
  }

  throw new Error("Timeout waiting for condition");
}

export async function mockSnsMessage(key: string, operation: "put" | "delete") {
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
            object: { key: toPrefixedKey(key) },
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

export async function cleanupLocalDirectories(
  baseDir: string = import.meta.dirname,
) {
  const testClientDirectories = (await readdir(baseDir)).filter((file) =>
    file.startsWith("test-client-"),
  );
  await Promise.all(
    testClientDirectories.map((directory) =>
      rm(path.join(baseDir, directory), {
        recursive: true,
        force: true,
      }),
    ),
  );
}

// Limited to 1000 objects!
export async function cleanupS3() {
  try {
    const { Contents } = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: S3_PREFIX,
      }),
    );

    if (!Contents?.length) {
      return;
    }

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
        const directory = syncDirectory(id);
        await mkdir(directory, { recursive: true });
        return [id, directory] as const;
      }),
    ),
  ) as Record<T[number], string>;
}

/**
 * Includes sending SNS message
 */
export async function createFile(id: number, key: string, content: string) {
  const clientDirectory = syncDirectory(id);
  if (key.endsWith("/")) {
    await mkdir(path.join(clientDirectory, key), { recursive: true });
  } else {
    await mkdir(path.dirname(path.join(clientDirectory, key)), {
      recursive: true,
    });
    await writeFile(path.join(clientDirectory, key), content);
  }

  let lastModified: Date | undefined;
  await waitUntil(async () => {
    const { Body, LastModified } = await s3Client.send(
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: toPrefixedKey(key),
      }),
    );
    lastModified = LastModified;

    // We have to check content in case the file already existed
    const actualContent = await Body?.transformToString();
    return actualContent === content;
  });

  // Wait for modified timestamp syncing
  if (lastModified) {
    await waitUntil(
      async () =>
        (await stat(path.join(clientDirectory, key))).mtime.valueOf() ===
        lastModified!.valueOf(),
    );
  } else {
    throw new Error("No last modified info for " + key);
  }

  await mockSnsMessage(key, "put");
}

/**
 * Includes sending SNS message
 */
export async function createDirectory(id: number, key: `${string}/`) {
  await createFile(id, key, "");
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
      Prefix: toPrefixedKey(prefix),
    }),
  );
}

export async function startClients(ids: readonly number[]) {
  await Promise.all(
    ids.map(async (id) => {
      const clientDirectory = localDirectory(id);

      const clientProcess = spawn(
        "node",
        [path.join(import.meta.dirname, "../dist/index.js"), "cli"],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, LOCAL_DIR: clientDirectory },
        },
      );

      clients.set(id, clientProcess);
      clientProcess.on("exit", () => {
        clients.delete(id);
      });

      clientLogs[id] ??= "";

      const colorCode = 31 + (id % 6); // Colors from 31-36 (red, green, yellow, blue, magenta, cyan)
      function processBuffer(data: Buffer, stream: "stdout" | "stderr") {
        data
          .toString()
          .trim()
          .split("\n")
          .forEach((line) => {
            process[stream].write(
              `\u001B[${colorCode}m[${id}]\u001B[0m ${line}\n`,
            );
            clientLogs[id] += line + "\n";
          });
      }
      clientProcess.stdout.on("data", (data: Buffer) => {
        processBuffer(data, "stdout");
      });
      clientProcess.stderr.on("data", (data: Buffer) => {
        processBuffer(data, "stderr");
      });

      await waitUntil(() =>
        clientLogs[id]
          ?.trim()
          .endsWith(`Watching for changes in ${clientDirectory}`),
      );

      // Despite waiting for the log output, it seems like the client might still not be fully ready. (Flaky tests)
      await pause(200);
    }),
  );
}

export async function startServer() {
  const serverPath = path.join(import.meta.dirname, "../../server");
  serverProcess = spawn(
    "node",
    ["--experimental-transform-types", serverPath],
    {
      env: process.env,
      stdio: "inherit",
      cwd: serverPath,
    },
  );

  await waitUntil(async () => {
    const response = await fetch(SERVER_URL);
    return response.ok && (await response.text()) === "Running.";
  });
}

export async function stopClients(ids?: readonly number[]) {
  await Promise.all(
    (ids ?? [...clients.keys()]).map(async (id) => {
      await killProcess(clients.get(id));
      clients.delete(id);
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
      Key: toPrefixedKey(key),
      Body: key.endsWith("/") ? "" : (body ?? ""),
    },
  }).done();
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeout = 1000,
): Promise<T> {
  const timeoutError = new Error(`Operation timed out after ${timeout} ms`);
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(timeoutError), timeout),
    ),
  ]);
}
