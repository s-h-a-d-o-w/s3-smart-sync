import { getEnvironmentVariables } from "../getEnvironmentVariables.js";

export const RECONNECT_DELAY = parseInt(
  process.env["RECONNECT_DELAY"] || "500",
  10,
);

export const { AWS_REGION, S3_BUCKET, WEBSOCKET_URL, LOCAL_DIR } =
  getEnvironmentVariables(
    "AWS_REGION",
    "S3_BUCKET",
    "WEBSOCKET_URL",
    "LOCAL_DIR",
  );
