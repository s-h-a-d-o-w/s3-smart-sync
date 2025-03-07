import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { fileExists } from "@s3-smart-sync/shared/fileExists.js";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  ACCESS_KEY,
  AWS_REGION,
  S3_BUCKET,
  SECRET_KEY,
} from "../src/consts.js";
import { IGNORE_CLEANUP_DURATION } from "../src/fileWatcher.js";
import {
  cleanupLocalDirectories,
  cleanupS3,
  createClientDirectories,
  createFile,
  pause,
  sendSnsMessage,
  startClients,
  startServer,
  stopClients,
  stopServer,
  waitUntil,
} from "./utilities.js";

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

describe("E2E Tests", () => {
  beforeAll(async () => {
    // test file syncing while we start everything necessary for all tests
    await createClientDirectories([1, 2]);

    for (const [key, content] of Object.entries(TEST_FILES)) {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: Buffer.from(content),
        }),
      );
    }

    await startServer();
    startClients([1, 2]);

    await waitUntil(async () => {
      await verifyFiles(CLIENT_1_DIR);
      await verifyFiles(CLIENT_2_DIR);
    });
  });

  afterAll(async () => {
    await cleanupS3();
    await cleanupLocalDirectories(true);
    await stopClients([1, 2]);
    await stopServer();
  });

  beforeEach(async () => {
    await cleanupS3();
    await cleanupLocalDirectories();
  });

  it("should sync file changes between clients", async () => {
    await createFile(1, "new-file.txt", "New content");
    await waitUntil(async () =>
      expect(await readFile(join(CLIENT_2_DIR, "new-file.txt"), "utf-8")).toBe(
        "New content",
      ),
    );

    await pause(IGNORE_CLEANUP_DURATION + 10);

    await createFile(2, "new-file.txt", "Changed content");
    await waitUntil(async () =>
      expect(await readFile(join(CLIENT_1_DIR, "new-file.txt"), "utf-8")).toBe(
        "Changed content",
      ),
    );
  });

  it("should handle replacing a file with an empty directory", async () => {
    await createFile(1, "file-then-directory", "starts as a file");
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

    await createFile(1, "directory-then-file", "now it's a file");
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
