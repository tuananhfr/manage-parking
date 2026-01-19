import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import devicesRouter from "./routes/devices.js";
import lockersRouter from "./routes/lockers.js";
import logsRouter from "./routes/logs.js";
import dashboardRouter from "./routes/dashboard.js";
import settingsRouter from "./routes/settings.js";
import paymentsRouter from "./routes/payments.js";
import logger from "../utils/logger.js";

/**
 * Create Express app
 */
export function createApp() {
  const app = express();

  // Security middleware
  app.use(helmet());

  // CORS
  app.use(
    cors({
      origin: "*",
      credentials: true,
    })
  );

  // Body parser
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    message: "Too many requests from this IP",
  });
  app.use(limiter);

  // Request logging
  app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });

  // Health check
  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // API routes
  app.use("/api/devices", devicesRouter);
  app.use("/api/lockers", lockersRouter);
  app.use("/api/logs", logsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/payments", paymentsRouter);

  // 404 handler
  app.use(notFoundHandler);

  // Error handler
  app.use(errorHandler);

  return app;
}

export default { createApp };
