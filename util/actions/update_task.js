const agentScheduler = require('../../util/AgentScheduler')
const { resolveTime } = require('../../util/AgentClock')

module.exports = {
  name: 'update_task',
  description: 'Updates an existing scheduled task with new details (time, description, or recurrence).',
  schema: {
    id: 'The unique ID of the task to update.',
    description: 'Optional: New description of what the task should do.',
    when: 'Optional: New natural language time (e.g. "tomorrow at 10am").',
    repeat: 'Optional: New recurrence ("hourly", "daily", "weekly", or "none").',
    channelId: 'Optional: New Discord channel ID where the task should execute.'
  },
  execute: async (bot, channel, params, context) => {
    const { id, description, when, repeat, channelId } = params

    if (!id) {
      throw new Error('Missing "id" parameter for updating a task.')
    }

    const updates = {}
    if (description) updates.description = description
    if (channelId) updates.channelId = channelId

    if (when) {
      const scheduledAt = await resolveTime(when)
      if (!scheduledAt) {
        throw new Error(`Could not resolve your time expression: "${when}".`)
      }
      updates.scheduledAt = scheduledAt
    }

    if (repeat !== undefined) {
      if (repeat === 'none' || repeat === null) {
        updates.repeat = null
      } else if (['hourly', 'daily', 'weekly'].includes(repeat)) {
        updates.repeat = repeat
      }
    }

    const updatedTask = agentScheduler.update(id, updates)

    if (!updatedTask) {
      return `[SYSTEM: Failed to update task ${id} - no task found with that ID.]`
    }

    const timeString = new Date(updatedTask.scheduledAt).toLocaleString()
    const repeatString = updatedTask.repeat ? ` (repeating ${updatedTask.repeat})` : ''

    const response = '✅ **Task Updated Successfully!**\n' +
                         `**ID:** \`${updatedTask.id}\`\n` +
                         `**Task:** ${updatedTask.description}\n` +
                         `**Target:** <#${updatedTask.channelId}>\n` +
                         `**Time:** ${timeString}${repeatString}`

    return response
  }
}
