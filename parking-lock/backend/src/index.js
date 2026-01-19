import http from "http";
import config from "./config/config.js";
import logger from "./utils/logger.js";
import { initDatabase } from "./database/db.js";
import { runMigrations } from "./database/migrations.js";
import { createApp } from "./api/app.js";
import { initWebSocket, getEventEmitter } from "./websocket/socket-server.js";
import { startTcpServer, setWebSocketEmitter } from "./tcp-server/server.js";

/**
 * Start the application
 */
async function startApp() {
  try {
    logger.info("=".repeat(60));
    logger.info("Starting Parking Lock Management System");
    logger.info("=".repeat(60));

    // 1. Initialize database
    logger.info("Initializing database...");
    initDatabase();
    await runMigrations();
    logger.info("✓ Database ready");

    // 2. Create Express app
    logger.info("Creating Express app...");
    const app = createApp();
    logger.info("✓ Express app created");

    // 3. Create HTTP server
    const httpServer = http.createServer(app);

    // 4. Initialize WebSocket server
    logger.info("Initializing WebSocket server...");
    initWebSocket(httpServer);
    logger.info("✓ WebSocket server ready");

    // 5. Set WebSocket emitter for TCP server
    setWebSocketEmitter(getEventEmitter());

    // 6. Start TCP server
    logger.info("Starting TCP server...");
    await startTcpServer();
    logger.info("✓ TCP server started");

    // 7. Start HTTP server
    logger.info("Starting HTTP server...");
    httpServer.listen(config.port, config.host, () => {
      logger.info("=".repeat(60));
      logger.info("✓ Parking Lock Management System is running!");
      logger.info("=".repeat(60));
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(`HTTP API: http://${config.host}:${config.port}`);
      logger.info(`WebSocket: http://${config.host}:${config.port}`);
      logger.info(`TCP Server: ${config.host}:${config.tcpPort}`);
      logger.info("=".repeat(60));
      logger.info(
        `💡 Để thiết bị kết nối, sử dụng IP public của VPS và port ${config.tcpPort}`
      );
      logger.info("=".repeat(60));
    });

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info("Shutting down gracefully...");

      httpServer.close(() => {
        logger.info("HTTP server closed");
      });

      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (error) {
    logger.error("Failed to start application:", error);
    process.exit(1);
  }
}

// Start the app
startApp();
