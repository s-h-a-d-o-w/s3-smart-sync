import winston, { format } from "winston";

const { combine, timestamp, printf } = format;

const IS_CLI = process.argv.includes("cli");
const IS_DEV = process.env["NODE_ENV"] !== "production";
const IS_SERVER = Boolean(process.env["IS_SERVER"]);

export function getLogLevel() {
  if (IS_DEV) {
    return "debug";
  }

  if (IS_SERVER) {
    return "info";
  }

  return process.argv.includes("info")
    ? "info"
    : process.argv.includes("debug")
      ? "debug"
      : "error";
}
const logLevel = process.env["LOG_LEVEL"] ?? getLogLevel();

const myFormat = combine(
  timestamp(),
  printf(
    ({ level, message, timestamp: ts }) =>
      // oxlint-disable-next-line typescript/restrict-template-expressions
      `${ts} [${level}]: ${message}`,
  ),
);

const transports = [
  new winston.transports.File({ filename: "error.log", level: "error" }),
];
if (logLevel === "info" || logLevel === "debug") {
  transports.push(new winston.transports.File({ filename: "combined.log" }));
}

export const logger = winston.createLogger({
  level: logLevel,
  format: myFormat,
  transports:
    IS_CLI || IS_SERVER
      ? [
          new winston.transports.Console({
            format: myFormat,
          }),
        ]
      : transports,
});
