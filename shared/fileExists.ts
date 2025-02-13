import { access } from "node:fs/promises";

export async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch (_) {
    return false;
  }
}
