const telemetry = require('../telemetry')

module.exports = {
  name: 'get_command_stats',
  description: 'Retrieves cross-server command usage metrics, invocation frequencies, top commands, active servers, and recent errors.',
  schema: {
    timeframe_hours: {
      type: 'integer',
      description: 'Hours to look back (e.g. 24 for past day, 168 for past week, 720 for past month, 0 for all-time). Default is 168 (7 days).'
    },
    guild_id: {
      type: 'string',
      description: 'Optional filter for a specific guild ID or "DM" for direct messages.'
    },
    command_name: {
      type: 'string',
      description: 'Optional filter for a specific command name (e.g. "roll", "netstats", "chat").'
    }
  },
  execute: async (bot, channel, params, context) => {
    const timeframeHours = params?.timeframe_hours !== undefined ? parseInt(params.timeframe_hours) : 168
    const guildId = params?.guild_id || null
    const commandName = params?.command_name || null

    const stats = telemetry.getStats({
      timeframeHours,
      guildId,
      commandName
    })

    const summary = telemetry.formatStatsSummary(stats)
    return `[SYSTEM: Telemetry Stats Retrieved:\n${summary}\n\nUse this data to answer the user's question about command usage accurately and naturally.]`
  }
}
