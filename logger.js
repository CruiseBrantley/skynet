const winston = require('winston')

// Configure logger settings
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  colorize: true,
  // defaultMeta: { service: 'user-service' },
  transports: [new winston.transports.File({ filename: './logs/combined.log' })]
})
// debug logging under here, remove for prod
logger.add(
  new winston.transports.Console({
    format: winston.format.simple()
  })
)
module.exports = logger
