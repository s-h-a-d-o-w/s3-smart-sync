import winston, { format } from "winston";

const { combine, timestamp, printf } = format;

const IS_PKG = process.pkg !== undefined;
const IS_DEV = process.env["NODE_ENV"] !== "production";

export function getLogLevel() {
  // server has NODE_ENV set in production and the client pkg
  if (!IS_PKG && IS_DEV) {
    return "debug";
  }

  return !process.argv[2]
    ? "error"
    : process.argv[2] === "info" || process.argv.includes("cli")
      ? "info"
      : process.argv[2] === "debug"
        ? "debug"
        : "error";
}

const logLevel = getLogLevel();

const myFormat = combine(
  timestamp(),
  printf(({ level, message, timestamp }) => {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    return `${timestamp} [${level}]: ${message}`;
  }),
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
  transports: IS_PKG
    ? transports
    : [
        new winston.transports.Console({
          format: myFormat,
        }),
      ],
});
