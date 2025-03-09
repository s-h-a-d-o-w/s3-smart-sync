import { fileExists } from "@s3-smart-sync/shared/fileExists.js";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  IGNORE_CLEANUP_DURATION,
  WATCHER_DEBOUNCE_DURATION,
} from "../src/fileWatcher.js";
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

const clientIds = [0, 1] as const;
const clientDirectories = await createClientDirectories(clientIds);

describe("E2E Tests", () => {
  beforeAll(async () => {
    await startServer();
    // startClients([0, 1]);
    startClients([0, 1], [0, 1]);
    await pause(1000);
  });

  afterAll(async () => {
    await stopClients([0, 1]);
    await stopServer();
    await cleanupS3();
    await cleanupLocalDirectories(true);
  });

  beforeEach(async () => {
    await cleanupS3();
  });

  it("should sync correctly on startup", async () => {
    const TEST_FILES = {
      "test1.txt": "Hello World",
      "folder1/test2.txt": "Nested file content",
      // Empty folders have to declare a body of either "" or Buffer.from("")
      "folder1/empty/": "",
      "folder2/test3.txt": "Another nested file",
    };

    async function verifyFiles(clientDir: string) {
      for (const [key, expectedContent] of Object.entries(TEST_FILES)) {
        const filePath = join(clientDir, key);

        if (!(await fileExists(filePath))) {
          throw new Error(`File ${filePath} does not exist`);
        }

        if (key.endsWith("/")) {
          if (!(await stat(filePath)).isDirectory()) {
            throw new Error(
              `Expected ${filePath} to be a directory, but it's not`,
            );
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

    await stopClients([0]);
    await Promise.all(
      Object.entries(TEST_FILES).map(([key, content]) =>
        createFile(1, key, content),
      ),
    );
    startClients([0]);

    await waitUntil(async () => {
      await verifyFiles(clientDirectories[0]);
      await verifyFiles(clientDirectories[1]);
    });
  });

  it("can handle large files", async () => {
    const largeContent = "a".repeat(10 * 1000 * 1000);
    await createFile(0, "large-file.txt", largeContent);
    await waitUntil(
      async () =>
        expect(
          await readFile(join(clientDirectories[1], "large-file.txt"), "utf-8"),
        ).toBe(largeContent),
      { timeout: 10000 },
    );
  }, 20000);

  it("should sync file changes between clients", async () => {
    await createFile(0, "new-file.txt", "New content");
    await waitUntil(async () =>
      expect(
        await readFile(join(clientDirectories[1], "new-file.txt"), "utf-8"),
      ).toBe("New content"),
    );

    await pause(IGNORE_CLEANUP_DURATION + 10);

    await createFile(1, "new-file.txt", "Changed content");
    await waitUntil(async () =>
      expect(
        await readFile(join(clientDirectories[0], "new-file.txt"), "utf-8"),
      ).toBe("Changed content"),
    );
  });

  it("should handle replacing a file with an empty directory", async () => {
    await createFile(0, "file-then-directory", "starts as a file");
    await waitUntil(async () =>
      expect(
        await fileExists(join(clientDirectories[1], "file-then-directory")),
      ).toBe(true),
    );

    await rm(join(clientDirectories[0], "file-then-directory"));
    await pause(WATCHER_DEBOUNCE_DURATION + 10);
    await sendSnsMessage("file-then-directory", "delete");
    await pause(IGNORE_CLEANUP_DURATION + 10);

    await mkdir(join(clientDirectories[0], "file-then-directory"));
    // First, the debounced upload. Then we have to wait for the upload to actually have finished
    await pause(WATCHER_DEBOUNCE_DURATION + 300);
    await sendSnsMessage("file-then-directory/", "put");

    await waitUntil(async () => {
      const stats = await stat(
        join(clientDirectories[1], "file-then-directory"),
      );
      return stats.isDirectory();
    });
  });

  it("should handle replacing an empty directory with a file", async () => {
    await mkdir(join(clientDirectories[0], "directory-then-file"));
    // First, the debounced upload. Then we have to wait for the upload to actually have finished
    await pause(WATCHER_DEBOUNCE_DURATION + 300);
    await sendSnsMessage("directory-then-file/", "put");
    await waitUntil(async () => {
      const stats = await stat(
        join(clientDirectories[1], "directory-then-file"),
      );
      return stats.isDirectory();
    });

    await rm(join(clientDirectories[0], "directory-then-file"), {
      recursive: true,
    });
    await sendSnsMessage("directory-then-file/", "delete");
    await pause(IGNORE_CLEANUP_DURATION + 10);

    await createFile(0, "directory-then-file", "now it's a file");
    await waitUntil(async () => {
      expect(
        await readFile(
          join(clientDirectories[1], "directory-then-file"),
          "utf-8",
        ),
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
