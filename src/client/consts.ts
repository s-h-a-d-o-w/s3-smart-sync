import untildify from "untildify";
import { getEnvironmentVariables } from "../getEnvironmentVariables.js";

export const IS_CLI = process.argv.includes("cli");
// @ts-expect-error
export const IS_PKG = Boolean(process.pkg);
export const IS_WINDOWS = process.platform === "win32";

export const RECONNECT_DELAY = parseInt(
  process.env["RECONNECT_DELAY"] || "500",
  10,
);

const { LOCAL_DIR: RAW_LOCAL_DIR } = getEnvironmentVariables("LOCAL_DIR");
export const LOCAL_DIR = untildify(RAW_LOCAL_DIR);

export const { ACCESS_KEY, AWS_REGION, S3_BUCKET, SECRET_KEY, WEBSOCKET_URL } =
  getEnvironmentVariables(
    "ACCESS_KEY",
    "AWS_REGION",
    "S3_BUCKET",
    "SECRET_KEY",
    "WEBSOCKET_URL",
  );
