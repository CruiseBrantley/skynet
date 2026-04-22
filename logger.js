const winston = require('winston')

const isTest = process.env.NODE_ENV === 'test';
const level = process.env.LOG_LEVEL || (isTest ? 'error' : 'info');

// Configure logger settings
const logger = winston.createLogger({
  level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  colorize: true,
  transports: [
    new winston.transports.File({ 
      filename: './logs/combined.log', 
      silent: isTest,
      maxsize: 10 * 1024 * 1024, // 10MB per file
      maxFiles: 5,               // Keep 5 rotated files
      tailable: true
    })
  ]
});

// Add console transport with appropriate level
logger.add(
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message }) => {
        return `${timestamp} [${level}]: ${message}`;
      })
    ),
    silent: isTest && !process.env.LOG_LEVEL // Silent in tests unless level is forced
  })
);
module.exports = logger
