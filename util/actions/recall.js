const agentMemory = require('../AgentMemory')
const logger = require('../../logger')

module.exports = {
  name: 'recall',
  description: 'Retrieves memories, rules, or user preferences from persistent long-term memory by key or prefix. If key is omitted, lists all active memories in scope.',
  schema: {
    key: {
      type: 'string',
      description: 'The memory key to look up (e.g. "user.cruise.preference") or prefix (e.g. "user.cruise"). Optional: leave empty to list all memories.'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const key = (params.key || '').trim()
    const guildId = context.guildId || channel?.guild?.id || channel?.guildId || null

    try {
      if (key) {
        const directValue = agentMemory.get(key, guildId)
        if (directValue !== null && directValue !== undefined) {
          return {
            success: true,
            key,
            value: directValue,
            message: `Memory found: "${key}" = "${directValue}"`
          }
        }

        // Search for prefix or substring matches in active memories
        const allMemories = Object.entries(agentMemory.getAll(guildId)).map(([k, v]) => ({
          key: k,
          value: v.value,
          updatedAt: v.updatedAt,
          ttlDays: v.ttlDays
        }))
        const matching = allMemories.filter(m => m.key.toLowerCase().includes(key.toLowerCase()))

        if (matching.length > 0) {
          return {
            success: true,
            query: key,
            count: matching.length,
            matches: matching,
            message: `Found ${matching.length} matching memories for "${key}".`
          }
        }

        return {
          success: false,
          key,
          error: `No memory found matching key "${key}".`
        }
      }

      // No key provided — return list of active memories
      const memories = Object.entries(agentMemory.getAll(guildId)).map(([k, v]) => ({
        key: k,
        value: v.value,
        updatedAt: v.updatedAt,
        ttlDays: v.ttlDays
      }))
      return {
        success: true,
        count: memories.length,
        memories,
        message: `Retrieved ${memories.length} memories for current scope.`
      }
    } catch (err) {
      logger.error(`recall failed: ${err.message}`)
      return { success: false, error: `Failed to recall memory: ${err.message}` }
    }
  }
}
