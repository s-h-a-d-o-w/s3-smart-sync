import { logger } from "@s3-smart-sync/shared/logger.js";
import { shutdown } from "./index.js";

// While it's kind of important to write these errors to the log, they also make it possible for the popup on missing environment variables to show. I don't know why node doesn't show it when these handlers don't exist...
process.on("uncaughtException", (error) => {
  logger.error(
    `Uncaught exception: ${error.message}\n` +
      `Exception origin: ${error.stack}`,
  );
});

process.on("unhandledRejection", (reason) => {
  const error = new Error(`Unhandled Rejection - reason: ${String(reason)}`);
  logger.error(error.message + " - at: " + error.stack);
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM signal, cleaning up...");
  await shutdown();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("Received SIGINT signal, cleaning up...");
  await shutdown();
  process.exit(0);
});
