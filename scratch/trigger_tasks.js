const bot = require('../bot')
const agentScheduler = require('../util/AgentScheduler')
const logger = require('../logger')

bot.on('ready', async () => {
  logger.info('Manual Trigger: Running processDueTasks...')
  try {
    await agentScheduler.processDueTasks(bot)
    logger.info('Manual Trigger: Done.')
  } catch (e) {
    logger.error('Manual Trigger Failed: ' + e.message)
  }
  process.exit(0)
})
