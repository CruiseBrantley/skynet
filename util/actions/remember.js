const agentMemory = require('../AgentMemory')
const logger = require('../../logger')

module.exports = {
  name: 'remember',
  description: 'Stores a persistent memory, rule, or user preference in long-term memory. Survives bot restarts and is hydrated into conversation context.',
  schema: {
    key: {
      type: 'string',
      description: 'The memory key (e.g. "user.cruise.preference", "server.ongoing_topic", "preference.music_genre"). Use "user.<name>.*" or "preference.*" for global user memories.'
    },
    value: {
      type: 'string',
      description: 'The information, fact, preference, or context to remember.'
    },
    ttl_days: {
      type: 'number',
      description: 'Expiration in days. Use -1 for permanent (default), or a positive number (e.g. 7 for 1 week).'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const key = (params.key || '').trim()
    const value = params.value !== undefined ? String(params.value) : ''

    if (!key) {
      return { success: false, error: 'Parameter "key" is required.' }
    }
    if (!value) {
      return { success: false, error: 'Parameter "value" is required.' }
    }

    const ttlDays = params.ttl_days !== undefined ? Number(params.ttl_days) : -1
    const guildId = context.guildId || channel?.guild?.id || channel?.guildId || null

    try {
      agentMemory.set(key, value, ttlDays, guildId)
      logger.info(`remember: Saved memory key="${key}" (ttl: ${ttlDays})`)
      return {
        success: true,
        key,
        value,
        ttl_days: ttlDays,
        message: `Successfully remembered: "${key}" = "${value}"`
      }
    } catch (err) {
      logger.error(`remember failed: ${err.message}`)
      return { success: false, error: `Failed to save memory: ${err.message}` }
    }
  }
}
