const agentMemory = require('../AgentMemory')
const logger = require('../../logger')

module.exports = {
  name: 'forget',
  description: 'Deletes a key or preference from persistent long-term agent memory.',
  schema: {
    key: {
      type: 'string',
      description: 'The exact memory key to delete.'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const key = (params.key || '').trim()
    if (!key) {
      return { success: false, error: 'Parameter "key" is required.' }
    }

    try {
      const deleted = agentMemory.delete(key)
      logger.info(`forget: Deleted memory key="${key}" (deleted=${deleted})`)
      return {
        success: true,
        key,
        deleted,
        message: deleted
          ? `Successfully removed memory "${key}".`
          : `Key "${key}" was not found in memory.`
      }
    } catch (err) {
      logger.error(`forget failed: ${err.message}`)
      return { success: false, error: `Failed to delete memory: ${err.message}` }
    }
  }
}
