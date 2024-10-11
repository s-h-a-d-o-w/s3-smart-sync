import winston, { format } from "winston";

const { combine, timestamp, printf } = format;

const myFormat = combine(
  timestamp(),
  printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
  }),
);

export const logger = winston.createLogger({
  format: myFormat,
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
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
