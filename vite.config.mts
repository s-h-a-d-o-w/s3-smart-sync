import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig({
  test: {
    globals: true,
    env: loadEnv("test", process.cwd(), ""),
  },
});
