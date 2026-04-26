const logger = require('../../logger')
const agentScheduler = require('../../util/AgentScheduler')
const { resolveTime } = require('../../util/AgentClock')

module.exports = {
  name: 'schedule_task',
  description: 'Schedule a message, poll, or action to be executed in the future or recurringly (hourly/daily/weekly).',
  schema: {
    description: 'What the task should do (e.g. "Send a dnd attendance poll to <#channelId>")',
    when: 'Natural language time (e.g. "tomorrow at 10am", "every saturday at 1pm", "in 30 minutes")',
    repeat: 'Optional recurrence: "hourly", "daily", or "weekly"',
    channelId: 'The Discord channel ID string (snowflake) where the task should execute'
  },
  execute: async (bot, channel, params, context) => {
    const { description, when, repeat, channelId } = params

    if (!description || !when) {
      throw new Error('Missing "description" or "when" parameters for scheduling.')
    }

    logger.info(`Action: schedule_task - input when="${when}"`)

    // 1. Resolve time string to timestamp
    const scheduledAt = await resolveTime(when)
    if (!scheduledAt) {
      throw new Error(`Could not resolve your time expression: "${when}". Try being more specific like "at 10am" or "tomorrow at 2pm".`)
    }

    // 2. Add to the local scheduler
    const targetChannelId = channelId || context.channelId || channel.id
    const task = agentScheduler.add({
      description,
      scheduledAt,
      userId: context.user?.id || context.userId || null,
      guildId: context.guild?.id || context.guildId || null,
      channelId: targetChannelId,
      repeat: ['hourly', 'daily', 'weekly'].includes(repeat) ? repeat : null,
      createdBy: context.user?.username || 'chat_agent'
    })

    const timeString = new Date(scheduledAt).toLocaleString()
    const repeatString = task.repeat ? ` (repeating ${task.repeat})` : ''

    // 3. Confirm back to user
    const response = '✅ **Task Scheduled Successfully!**\n' +
                         `**ID:** \`${task.id}\`\n` +
                         `**Task:** ${description}\n` +
                         `**Target:** <#${targetChannelId}>\n` +
                         `**Time:** ${timeString}${repeatString}`

    if (context && typeof context.reply === 'function' && !context.replied) {
      await context.reply(response)
    } else if (channel && typeof channel.send === 'function') {
      await channel.send(response)
    }

    return task
  }
}
