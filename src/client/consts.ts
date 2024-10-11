import { getEnvironmentVariables } from "../getEnvironmentVariables.js";

export const {
  AWS_REGION,
  RECONNECT_DELAY,
  S3_BUCKET,
  WEBSOCKET_URL,
  LOCAL_DIR,
} = getEnvironmentVariables(
  "AWS_REGION",
  "RECONNECT_DELAY",
  "S3_BUCKET",
  "WEBSOCKET_URL",
  "LOCAL_DIR",
);
