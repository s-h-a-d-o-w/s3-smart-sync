import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { fileExists } from "@s3-smart-sync/shared/fileExists.js";
import { logger } from "@s3-smart-sync/shared/logger.js";
import { ChildProcess, spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path, { join } from "node:path";
import {
  ACCESS_KEY,
  AWS_REGION,
  S3_BUCKET,
  SECRET_KEY,
} from "../src/consts.js";

const TEST_FILES = {
  "test1.txt": "Hello World",
  "folder1/test2.txt": "Nested file content",
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

async function uploadTestFiles() {
  for (const [key, content] of Object.entries(TEST_FILES)) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: Buffer.from(content),
      }),
    );
  }
}

async function cleanupS3() {
  for (const key of Object.keys(TEST_FILES)) {
    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
        }),
      );
    } catch (error) {
      logger.error(`Failed to delete ${key}: ${error}`);
    }
  }
}

async function cleanupLocalDirs() {
  await rm(CLIENT_1_DIR, { recursive: true, force: true });
  await rm(CLIENT_2_DIR, { recursive: true, force: true });
}

async function verifyFiles(clientDir: string) {
  for (const [key, expectedContent] of Object.entries(TEST_FILES)) {
    const filePath = join(clientDir, key);
    const exists = await fileExists(filePath);
    if (!exists) {
      throw new Error(`File ${filePath} does not exist`);
    }

    const content = await readFile(filePath, "utf-8");
    if (content !== expectedContent) {
      throw new Error(
        `Content mismatch for ${filePath}. Expected: ${expectedContent}, Got: ${content}`,
      );
    }
  }
}

async function waitForServer() {
  const url = process.env["WEBSOCKET_URL"]!.replace("ws", "http");

  while (true) {
    console.log("trying", url);
    try {
      const response = await fetch(
        process.env["WEBSOCKET_URL"]!.replace("ws", "http"),
      );
      if (response.ok && (await response.text()) === "Running.") {
        return;
      }
    } catch (_) {
      // Ignore errors and keep trying
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

let serverProcess: ChildProcess | undefined;
let client1Process: ChildProcess | undefined;
let client2Process: ChildProcess | undefined;

describe("E2E Tests", () => {
  beforeAll(async () => {
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
      { env: { ...process.env, LOCAL_DIR: CLIENT_2_DIR } },
    );

    // Create test directories
    await mkdir(CLIENT_1_DIR, { recursive: true });
    await mkdir(CLIENT_2_DIR, { recursive: true });

    // Upload test files to S3
    await uploadTestFiles();
  });

  afterAll(async () => {
    await cleanupS3();
    await cleanupLocalDirs();

    client1Process?.kill();
    client2Process?.kill();
    serverProcess?.kill();
  });

  test("should sync files from S3 to multiple clients", async () => {
    while (true) {
      try {
        console.log("trying");
        await new Promise((resolve) => setTimeout(resolve, 500));

        await verifyFiles(CLIENT_1_DIR);
        await verifyFiles(CLIENT_2_DIR);
        break;
      } catch (_) {
        // empty
      }
    }
  });

  // test("should sync file changes between clients", async () => {
  //   // Start both clients
  //   const client1Process = spawn("node", ["src/index.ts"], {
  //     env: { ...process.env, LOCAL_DIR: CLIENT_1_DIR },
  //   });
  //   const client2Process = spawn("node", ["src/index.ts"], {
  //     env: { ...process.env, LOCAL_DIR: CLIENT_2_DIR },
  //   });

  //   // Wait for initial sync
  //   await new Promise((resolve) => setTimeout(resolve, 30000));

  //   // Create new file in client 1
  //   const newFilePath = join(CLIENT_1_DIR, "new-file.txt");
  //   await writeFile(newFilePath, "New content");

  //   // Wait for sync to happen
  //   await new Promise((resolve) => setTimeout(resolve, 10000));

  //   // Verify file exists in client 2
  //   const client2FilePath = join(CLIENT_2_DIR, "new-file.txt");
  //   const exists = await fileExists(client2FilePath);
  //   expect(exists).toBe(true);

  //   const content = await readFile(client2FilePath, "utf-8");
  //   expect(content).toBe("New content");

  //   // Cleanup
  //   client1Process.kill();
  //   client2Process.kill();
  // }, 60000);
});
