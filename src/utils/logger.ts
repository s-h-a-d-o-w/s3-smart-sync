import winston, { format } from "winston";

const { combine, timestamp, printf } = format;

export function getLogLevel() {
  return !process.argv[2]
    ? "error"
    : process.argv[2] === "info"
    ? "info"
    : process.argv[2] === "debug"
    ? "debug"
    : "error";
}

const logLevel = getLogLevel();

const myFormat = combine(
  timestamp(),
  printf(({ level, message, timestamp }) => {
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
  transports,
});

// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
if (process.env["NODE_ENV"] !== "production") {
  logger.add(
    new winston.transports.Console({
      format: myFormat,
    }),
  );
}
