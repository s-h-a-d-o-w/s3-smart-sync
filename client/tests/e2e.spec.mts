import { fileExists } from "@s3-smart-sync/shared/fileExists.js";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  UNIGNORE_DURATION,
  WATCHER_DEBOUNCE_DURATION,
} from "../src/fileWatcher.js";
import {
  cleanupLocalDirectories,
  cleanupS3,
  clientLogs,
  createClientDirectories,
  createFile,
  list,
  pause,
  sendSnsMessage,
  startClients,
  startServer,
  stopClients,
  stopServer,
  upload,
  waitUntil,
  withTimeout,
} from "./utilities.js";

const clientIds = [0, 1] as const;
let clientDirectories: Record<number, string>;

describe("E2E Tests", () => {
  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    const results = await Promise.allSettled([
      withTimeout(stopClients()),
      withTimeout(stopServer()),
    ]);

    results.push(
      ...(await Promise.allSettled([
        withTimeout(cleanupS3()),
        waitUntil(() => cleanupLocalDirectories()),
      ])),
    );

    const errors = results.filter((result) => result.status === "rejected");
    if (errors.length > 0) {
      errors.forEach((error) => {
        console.error(error);
      });
    }
  });

  beforeEach(async () => {
    clientDirectories = await createClientDirectories(clientIds);
    await startClients(clientIds);
  });

  afterEach(async () => {
    await stopClients();
    await Promise.all([
      cleanupS3(),
      // Due to windows potentially aggressively locking down the directories, we retry until it works
      waitUntil(() => cleanupLocalDirectories()),
    ]);
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

    await stopClients([1]);
    await Promise.all(
      Object.entries(TEST_FILES).map(([key, content]) =>
        createFile(0, key, content),
      ),
    );
    await startClients([1]);

    await waitUntil(async () => {
      await verifyFiles(clientDirectories[0]!);
      await verifyFiles(clientDirectories[1]!);
    });
  });

  it("can handle large files", async () => {
    const largeContent = "a".repeat(10 * 1000 * 1000);
    await createFile(0, "large-file.txt", largeContent);
    await waitUntil(
      async () =>
        expect(
          await readFile(
            join(clientDirectories[1]!, "large-file.txt"),
            "utf-8",
          ),
        ).toBe(largeContent),
      { timeout: 10000 },
    );

    // Client 1 shouldn't do anything after the download has finished. (Which means that the ignore mechanism works with large files.)
    await pause(WATCHER_DEBOUNCE_DURATION * 2);
    expect(clientLogs[1]!.trim().split("\n").at(-1)?.trim()).toMatch(
      /Downloaded: large-file\.txt$/,
    );
  }, 20000);

  it("should sync file changes between clients", async () => {
    await createFile(0, "new-file.txt", "New content");
    await waitUntil(async () =>
      expect(
        await readFile(join(clientDirectories[1]!, "new-file.txt"), "utf-8"),
      ).toBe("New content"),
    );
    await pause(UNIGNORE_DURATION + 10);

    await createFile(1, "new-file.txt", "Changed content");
    await waitUntil(async () =>
      expect(
        await readFile(join(clientDirectories[0]!, "new-file.txt"), "utf-8"),
      ).toBe("Changed content"),
    );
  });

  it("should handle replacing a file with an empty directory", async () => {
    await createFile(0, "file-then-directory", "starts as a file");
    await waitUntil(() =>
      fileExists(join(clientDirectories[1]!, "file-then-directory")),
    );

    await rm(join(clientDirectories[0]!, "file-then-directory"));
    await pause(WATCHER_DEBOUNCE_DURATION + 300);
    await sendSnsMessage("file-then-directory", "delete");

    await mkdir(join(clientDirectories[0]!, "file-then-directory"));
    // First, the debounced upload. Then we have to wait for the upload to actually have finished
    await pause(WATCHER_DEBOUNCE_DURATION + 300);
    await sendSnsMessage("file-then-directory/", "put");

    await waitUntil(async () =>
      (
        await stat(join(clientDirectories[1]!, "file-then-directory"))
      ).isDirectory(),
    );
  });

  it("should handle replacing an empty directory with a file", async () => {
    await mkdir(join(clientDirectories[0]!, "directory-then-file"));
    // First, the debounced upload. Then we have to wait for the upload to actually have finished
    await pause(WATCHER_DEBOUNCE_DURATION + 300);
    await sendSnsMessage("directory-then-file/", "put");
    await waitUntil(async () =>
      (
        await stat(join(clientDirectories[1]!, "directory-then-file"))
      ).isDirectory(),
    );

    await rm(join(clientDirectories[0]!, "directory-then-file"), {
      recursive: true,
    });
    await pause(WATCHER_DEBOUNCE_DURATION + 300);
    await waitUntil(async () => {
      const { Contents } = await list("directory-then-file/");
      return Contents === undefined;
    });
    await sendSnsMessage("directory-then-file/", "delete");

    await createFile(0, "directory-then-file", "now it's a file");
    await waitUntil(async () => {
      expect(
        await readFile(
          join(clientDirectories[1]!, "directory-then-file"),
          "utf-8",
        ),
      ).toBe("now it's a file");
    });
  });

  it("handles duplicate file/directory on S3 by deleting the older", async () => {
    await stopClients();
    await upload("duplicate-file/", "");
    await upload("duplicate-file/nested/", "");
    await upload("duplicate-file/nested/file.txt", "...");
    await upload("duplicate-file", "");

    await startClients(clientIds);
    await waitUntil(() =>
      readFile(join(clientDirectories[0]!, "duplicate-file"), "utf-8"),
    );

    const { Contents } = await list("duplicate-file");
    expect(Contents?.length).toBe(1);
    expect(Contents?.[0]?.Key).toBe("duplicate-file");
  });
});
