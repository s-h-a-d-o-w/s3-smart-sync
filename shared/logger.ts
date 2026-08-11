import winston, { format } from "winston";

const { combine, timestamp, printf } = format;

const IS_CLI = process.argv.includes("cli");
const IS_DEV = process.env["NODE_ENV"] !== "production";

export function getLogLevel() {
  if (IS_DEV) {
    return "debug";
  }

  if (process.env["IS_SERVER"]) {
    return "info";
  }

  return process.argv.includes("info")
    ? "info"
    : process.argv.includes("debug")
      ? "debug"
      : "error";
}
const logLevel = getLogLevel();

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
  transports: IS_CLI
    ? [
        new winston.transports.Console({
          format: myFormat,
        }),
      ]
    : transports,
});
