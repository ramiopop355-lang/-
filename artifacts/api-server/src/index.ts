import app from "./app";
import { logger } from "./lib/logger";

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — server continues");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled rejection — server continues");
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

server.keepAliveTimeout = 65_000;
server.headersTimeout   = 70_000;
