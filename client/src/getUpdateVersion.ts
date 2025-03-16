import { logger } from "@s3-smart-sync/shared/logger.js";
import packageJson from "../package.json" with { type: "json" };

const GITHUB_API_URL =
  "https://api.github.com/repos/s-h-a-d-o-w/s3-smart-sync/releases/latest";

export async function getUpdateVersion() {
  try {
    const response = await fetch(GITHUB_API_URL);
    const data = (await response.json()) as { tag_name: string };

    if (
      response.ok &&
      data?.tag_name?.replace("v", "") !== packageJson.version
    ) {
      return data.tag_name;
    }
  } catch (error) {
    logger.error("Failed to check for updates:", error);
  }
}
