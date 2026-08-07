import { join } from "node:path";
import { readFile, rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import chokidar from "chokidar";
import {
  cleanupLocalDirectories,
  cleanupS3,
  createClientDirectories,
  createFile,
  mockSnsMessage,
  startClients,
  startServer,
  stopClients,
  stopServer,
  waitUntil,
  withTimeout,
} from "./utilities.ts";

const clientIds = [0, 1] as const;

/**
 * Creates a watcher for a specific file and returns a promise that resolves when the file is added/changed/deleted
 */
function watchForFileEvent(
  filePath: string,
  eventType: "add" | "change" | "unlink",
): Promise<void> {
  return new Promise((resolve) => {
    const watcher = chokidar.watch(filePath, {
      awaitWriteFinish: true,
      ignoreInitial: eventType !== "add",
    });

    watcher.on(eventType, async () => {
      await watcher.close();
      resolve();
    });
  });
}

const clientDirectories = await createClientDirectories(clientIds);

async function start() {
  await startServer();
  await startClients(clientIds);
  await withTimeout(cleanupS3());
}

async function stop() {
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
}

async function getMeasurements() {
  const testFiles = {
    "small1.txt": "a".repeat(1 * 1024), // 1KB
    "small2.txt": "b".repeat(10 * 1024), // 10KB
    "medium.txt": "c".repeat(100 * 1024), // 100KB
    "large.txt": "d".repeat(1 * 1024 * 1024), // 1MB
    // "xlarge.txt": "e".repeat(10 * 1024 * 1024), // 10MB
  };

  const watchPromises = Object.keys(testFiles).map((key) => {
    return watchForFileEvent(join(clientDirectories[1], key), "add");
  });

  let startTime = performance.now();
  await Promise.all(
    Object.entries(testFiles).map(([key, content]) =>
      createFile(0, key, content),
    ),
  );
  await withTimeout(Promise.all(watchPromises), 10000);
  let endTime = performance.now();
  const syncTime = endTime - startTime;

  // Verify content is correct
  for (const [key, expectedContent] of Object.entries(testFiles)) {
    const filePath = join(clientDirectories[1], key);
    const content = await readFile(filePath, "utf-8");
    if (content !== expectedContent) {
      throw new Error(`Content didn't match for ${key}`);
    }
  }

  // Wait for things to have settled before continuing with the deletion benchmark
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const watchPromise = watchForFileEvent(
    join(clientDirectories[1], "small1.txt"),
    "unlink",
  );

  startTime = performance.now();
  await rm(join(clientDirectories[0], "small1.txt"));
  await mockSnsMessage("small1.txt", "delete");
  await withTimeout(watchPromise, 10000);
  endTime = performance.now();
  const deleteTime = endTime - startTime;

  return {
    syncTime,
    deleteTime,
  };
}

await start();
try {
  const { syncTime, deleteTime } = await getMeasurements();
  await stop();

  console.log(
    `Total sync time for all files: ${(syncTime / 1000).toFixed(1)}s`,
  );
  console.log(`File deletion sync time: ${(deleteTime / 1000).toFixed(1)}s`);
} catch (e) {
  console.error(e);
  await stop();
}
