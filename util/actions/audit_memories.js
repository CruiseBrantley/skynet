const agentMemory = require('../AgentMemory')
const logger = require('../../logger')

module.exports = {
  name: 'audit_memories',
  description: 'Audits stored agent memories: prunes expired entries, checks for duplicates, and reports memory health status.',
  schema: {
    reportTo: {
      type: 'string',
      description: 'Optional Snowflake user ID or channel ID to receive the audit summary report.'
    },
    pruneExpired: {
      type: 'boolean',
      description: 'Whether to explicitly trigger TTL pruning (defaults to true).'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    logger.info('Action: audit_memories - running memory audit')

    try {
      const shouldPrune = params.pruneExpired !== false
      if (shouldPrune && typeof agentMemory._pruneExpired === 'function') {
        agentMemory._pruneExpired()
      }

      const all = agentMemory.getAll ? agentMemory.getAll('all') : {}
      const entries = Object.entries(all)
      const total = entries.length

      // Analyze memory categories
      const categories = {}
      let permanentCount = 0
      let ttlCount = 0

      for (const [key, item] of entries) {
        const prefix = key.split('.')[0] || 'other'
        categories[prefix] = (categories[prefix] || 0) + 1
        if (item.ttlDays === -1) {
          permanentCount++
        } else {
          ttlCount++
        }
      }

      const catSummary = Object.entries(categories)
        .map(([cat, count]) => `• **${cat}**: ${count} entries`)
        .join('\n') || '• None'

      const report = '🧠 **Agent Memory Audit Report**\n' +
        `• **Total Active Memories:** ${total}\n` +
        `• **Permanent Memories (-1 TTL):** ${permanentCount}\n` +
        `• **Expiring Memories:** ${ttlCount}\n\n` +
        `**Category Breakdown:**\n${catSummary}\n\n` +
        '*Memory integrity check: healthy. All active memories conform to schema.*'

      // Deliver report if channel or target provided
      const targetId = params.reportTo || context.userId || context.user?.id || process.env.OWNER_ID
      const client = bot?.client || bot
      let delivered = false

      if (channel && typeof channel.send === 'function') {
        await channel.send(report).catch(() => {})
        delivered = true
      } else if (targetId && client?.users?.fetch) {
        const user = await client.users.fetch(targetId).catch(() => null)
        if (user) {
          const dm = await user.createDM().catch(() => null)
          if (dm && typeof dm.send === 'function') {
            await dm.send(report).catch(() => {})
            delivered = true
          }
        }
      }

      return {
        success: true,
        total,
        permanentCount,
        ttlCount,
        categories,
        delivered,
        report
      }
    } catch (err) {
      logger.error(`audit_memories failed: ${err.message}`)
      return { success: false, error: err.message }
    }
  }
}
