// utils/logger.js
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
  base: {
    pid: process.pid,
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
});

export default logger;
