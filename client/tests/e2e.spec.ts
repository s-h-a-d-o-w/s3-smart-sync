import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { fileExists } from "@s3-smart-sync/shared/fileExists.js";
import { logger } from "@s3-smart-sync/shared/logger.js";
import { ChildProcess, spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path, { join } from "node:path";
import {
  ACCESS_KEY,
  AWS_REGION,
  S3_BUCKET,
  SECRET_KEY,
} from "../src/consts.js";
import { SNSMessage } from "aws-lambda";
import { IGNORE_CLEANUP_DURATION } from "../src/fileWatcher.js";

const SERVER_URL = process.env["WEBSOCKET_URL"]!.replace("ws", "http");

const TEST_FILES = {
  "test1.txt": "Hello World",
  "folder1/test2.txt": "Nested file content",
  // Empty folders have to declare a body of either "" or Buffer.from("")
  "folder1/empty/": "",
  "folder2/test3.txt": "Another nested file",
};

const CLIENT_1_DIR = join(__dirname, "test-client-1");
const CLIENT_2_DIR = join(__dirname, "test-client-2");

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});

// Limited to 1000 objects!
async function cleanupS3() {
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

async function cleanupLocalDirs(fully?: boolean) {
  await rm(CLIENT_1_DIR, { recursive: true, force: true });
  await rm(CLIENT_2_DIR, { recursive: true, force: true });

  if (!fully) {
    await mkdir(CLIENT_1_DIR, { recursive: true });
    await mkdir(CLIENT_2_DIR, { recursive: true });
  }
}

async function createFile(baseDir: string, key: string, content: string) {
  await writeFile(join(baseDir, key), content);

  await waitUntil(async () => {
    const { Body } = await s3Client.send(
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      }),
    );

    const actualContent = await Body?.transformToString();
    return actualContent === content;
  });

  const snsMessage: SNSMessage = {
    Type: "Notification",
    MessageId: "dummy",
    MessageAttributes: {},
    TopicArn: "dummy",
    Message: JSON.stringify({
      Records: [
        {
          eventName: "ObjectCreated:Put",
          s3: {
            bucket: { name: S3_BUCKET },
            object: { key: key },
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
    body: JSON.stringify(snsMessage),
  });
}

async function sendSnsMessage(key: string, operation: "put" | "delete") {
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

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyFiles(clientDir: string) {
  for (const [key, expectedContent] of Object.entries(TEST_FILES)) {
    const filePath = join(clientDir, key);

    if (!(await fileExists(filePath))) {
      throw new Error(`File ${filePath} does not exist`);
    }

    if (key.endsWith("/")) {
      if (!(await stat(filePath)).isDirectory()) {
        throw new Error(`Expected ${filePath} to be a directory, but it's not`);
      }
    } else {
      const content = await readFile(filePath, "utf-8");
      if (content !== expectedContent) {
        throw new Error(
          `Content mismatch for ${filePath}. Expected: ${expectedContent}, Got: ${content}`,
        );
      }
    }
  }
}

async function waitForServer() {
  await waitUntil(async () => {
    const response = await fetch(SERVER_URL);
    return response.ok && (await response.text()) === "Running.";
  });
}

async function waitUntil(
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

let serverProcess: ChildProcess | undefined;
let client1Process: ChildProcess | undefined;
let client2Process: ChildProcess | undefined;

describe("E2E Tests", () => {
  beforeAll(async () => {
    // test file syncing while we start everything necessary for all tests
    await mkdir(CLIENT_1_DIR, { recursive: true });
    await mkdir(CLIENT_2_DIR, { recursive: true });

    for (const [key, content] of Object.entries(TEST_FILES)) {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: Buffer.from(content),
        }),
      );
    }

    serverProcess = spawn(
      "node",
      [path.join(__dirname, "../../server/server.js")],
      { env: process.env, stdio: "inherit" },
    );
    await waitForServer();

    client1Process = spawn(
      "node",
      [path.join(__dirname, "../dist/index.cjs"), "cli"],
      {
        // stdio: "inherit",
        env: { ...process.env, LOCAL_DIR: CLIENT_1_DIR },
      },
    );
    client2Process = spawn(
      "node",
      [path.join(__dirname, "../dist/index.cjs"), "cli"],
      {
        // stdio: "inherit",
        env: { ...process.env, LOCAL_DIR: CLIENT_2_DIR },
      },
    );

    await waitUntil(async () => {
      await verifyFiles(CLIENT_1_DIR);
      await verifyFiles(CLIENT_2_DIR);
    });
  });

  afterAll(async () => {
    await cleanupS3();
    await cleanupLocalDirs(true);
    await Promise.all([
      killProcess(client1Process),
      killProcess(client2Process),
      killProcess(serverProcess),
    ]);
  });

  beforeEach(async () => {
    await cleanupS3();
    await cleanupLocalDirs();
  });

  it("should sync file changes between clients", async () => {
    await createFile(CLIENT_1_DIR, "new-file.txt", "New content");
    await waitUntil(async () =>
      expect(await readFile(join(CLIENT_2_DIR, "new-file.txt"), "utf-8")).toBe(
        "New content",
      ),
    );

    await pause(IGNORE_CLEANUP_DURATION + 10);

    await createFile(CLIENT_2_DIR, "new-file.txt", "Changed content");
    await waitUntil(async () =>
      expect(await readFile(join(CLIENT_1_DIR, "new-file.txt"), "utf-8")).toBe(
        "Changed content",
      ),
    );
  });

  it("should handle replacing a file with an empty directory", async () => {
    await createFile(CLIENT_1_DIR, "file-then-directory", "starts as a file");
    await waitUntil(async () =>
      expect(await fileExists(join(CLIENT_2_DIR, "file-then-directory"))).toBe(
        true,
      ),
    );

    await rm(join(CLIENT_1_DIR, "file-then-directory"));
    await sendSnsMessage("file-then-directory", "delete");
    await pause(IGNORE_CLEANUP_DURATION + 10);

    await mkdir(join(CLIENT_1_DIR, "file-then-directory"));
    await sendSnsMessage("file-then-directory/", "put");

    await waitUntil(async () => {
      const stats = await stat(join(CLIENT_2_DIR, "file-then-directory"));
      return stats.isDirectory();
    });
  });

  it("should handle replacing an empty directory with a file", async () => {
    await mkdir(join(CLIENT_1_DIR, "directory-then-file"));
    await sendSnsMessage("directory-then-file/", "put");
    await waitUntil(async () => {
      const stats = await stat(join(CLIENT_2_DIR, "directory-then-file"));
      return stats.isDirectory();
    });

    await rm(join(CLIENT_1_DIR, "directory-then-file"), { recursive: true });
    await sendSnsMessage("directory-then-file/", "delete");
    await pause(IGNORE_CLEANUP_DURATION + 10);

    await createFile(CLIENT_1_DIR, "directory-then-file", "now it's a file");
    await waitUntil(async () => {
      expect(
        await readFile(join(CLIENT_2_DIR, "directory-then-file"), "utf-8"),
      ).toBe("now it's a file");
    });
  });

  // it("handles duplicate file/directory on S3", async () => {
  //   await s3Client.send(
  //     new PutObjectCommand({
  //       Bucket: S3_BUCKET,
  //       Key: "duplicate-file",
  //       Body: Buffer.from(""),
  //     }),
  //   );
  //   await s3Client.send(
  //     new PutObjectCommand({
  //       Bucket: S3_BUCKET,
  //       Key: "duplicate-file/",
  //       Body: Buffer.from(""),
  //     }),
  //   );

  //   await sendSnsMessage("duplicate-file/", "put");
  //   await waitUntil(async () => {
  //     const stats = await stat(join(CLIENT_1_DIR, "duplicate-file/"));
  //     return stats.isDirectory();
  //   });

  //   const { Contents } = await s3Client.send(
  //     new ListObjectsV2Command({
  //       Bucket: S3_BUCKET,
  //       Prefix: "duplicate-file/",
  //     }),
  //   );
  //   expect(Contents?.length).toBe(1);
  //   expect(Contents?.[0]?.Key).toBe("duplicate-file/");
  // });
});
