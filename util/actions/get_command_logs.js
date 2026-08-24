const telemetry = require('../telemetry')

module.exports = {
  name: 'get_command_logs',
  description: 'Retrieves a chronological feed of recent command executions, status (SUCCESS/ERROR), durations, and error traces across all servers.',
  schema: {
    limit: {
      type: 'integer',
      description: 'Number of recent log entries to retrieve (default: 15, max: 50).'
    },
    status: {
      type: 'string',
      description: 'Filter by execution status: "all" (default), "error", or "success".'
    },
    command_name: {
      type: 'string',
      description: 'Optional filter for a specific command name (e.g. "netstats", "server", "roll").'
    }
  },
  execute: async (bot, channel, params, context) => {
    const limit = params?.limit ? parseInt(params.limit) : 15
    const status = params?.status || 'all'
    const commandName = params?.command_name || null

    const logs = telemetry.getRecentLogs({
      limit,
      status,
      commandName
    })

    const summary = telemetry.formatRecentLogsSummary(logs, { status, commandName })
    return `[SYSTEM: Recent Command Logs Feed:\n${summary}\n\nUse this data to inspect command performance, diagnose recent failures, or report execution history naturally.]`
  }
}
