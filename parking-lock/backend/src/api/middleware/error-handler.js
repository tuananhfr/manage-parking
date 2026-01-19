import logger from '../../utils/logger.js';

/**
 * Global error handler middleware
 */
export function errorHandler(err, req, res, next) {
  logger.error('API Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
}

export default {
  errorHandler,
  notFoundHandler
};
