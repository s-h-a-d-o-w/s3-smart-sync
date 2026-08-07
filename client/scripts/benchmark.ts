import dotenv from "dotenv";
import { join } from "node:path";
dotenv.config({
  path: join(import.meta.dirname, "../../.env.test"),
});

// Environment variables have to be loaded before running the actual benchmark, so we have to prevent import hoisting like this
await import("./benchmark-implementation.ts");
