import dotenv from "dotenv";
import path from "node:path";

dotenv.config({
  path: path.join(import.meta.dirname, "../../.env.test"),
});

// Environment variables have to be loaded before running the actual benchmark, so we have to prevent import hoisting like this
await import("./benchmark-implementation.ts");
