import { getEnvironmentVariables } from "../getEnvironmentVariables.js";

// @ts-expect-error
export const IS_PKG = Boolean(process.pkg);

export const RECONNECT_DELAY = parseInt(
  process.env["RECONNECT_DELAY"] || "500",
  10,
);

export const {
  ACCESS_KEY,
  AWS_REGION,
  S3_BUCKET,
  SECRET_KEY,
  WEBSOCKET_URL,
  LOCAL_DIR,
} = getEnvironmentVariables(
  "ACCESS_KEY",
  "AWS_REGION",
  "S3_BUCKET",
  "SECRET_KEY",
  "WEBSOCKET_URL",
  "LOCAL_DIR",
);
