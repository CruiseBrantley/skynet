const agentScheduler = require('../AgentScheduler')

module.exports = {
  name: 'list_tasks',
  description: 'Lists all scheduled tasks for the current user.',
  schema: {},
  execute: async (bot, channel, params, context) => {
    const userId = context.userId || context.user?.id || context.member?.id
    if (!userId) {
      return '[SYSTEM: Error - Could not identify user ID.]'
    }

    const tasks = agentScheduler.getByUser(userId)
    if (tasks.length === 0) {
      return '[SYSTEM: No scheduled tasks found for your user profile.]'
    }

    const taskList = tasks.map(t => {
      const timeStr = new Date(t.scheduledAt).toLocaleString()
      const repeatStr = t.repeat ? ` (Repeats: ${t.repeat})` : ''
      return `- ID: ${t.id} | "${t.description.substring(0, 100)}" | Scheduled: ${timeStr}${repeatStr}`
    }).join('\n')

    return `[SYSTEM: Found ${tasks.length} scheduled tasks for your user profile:\n${taskList}\n\nPlease inform the user of their scheduled tasks naturally.]`
  }
}
