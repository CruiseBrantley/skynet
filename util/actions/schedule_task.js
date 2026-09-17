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
    channelId: 'The Discord channel ID string (snowflake) where the task should execute',
    action: 'Optional: Executable action name (e.g. "manage_workflows", "send_message", "audit_memories", "send_poll", "anime_sync")',
    params: 'Optional: Object containing parameters for the action'
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

    // 2. Resolve action and params at definition time if not explicitly provided
    let taskAction = params.action || null
    let taskParams = params.params || null

    if (!taskAction) {
      const desc = description.trim()
      const wfMatch = desc.match(/\b(?:run|execute)\s+workflow\s+([a-zA-Z0-9_-]+)(?:\s*\((wf_[a-zA-Z0-9_-]+)\))?/i)
      if (wfMatch) {
        taskAction = 'manage_workflows'
        taskParams = { action: 'run', name: wfMatch[2] || wfMatch[1] }
      } else if (/\b(?:memory\s+audit|audit\s+memor(?:y|ies))\b/i.test(desc)) {
        taskAction = 'audit_memories'
        taskParams = {}
      } else if (/\banime\s+sync\b/i.test(desc) || /\bsync\s+(?:watchlist|anime)\b/i.test(desc)) {
        taskAction = 'anime_sync'
        taskParams = { operation: 'sync_watchlist', silent_if_no_additions: true }
      }
    }

    // 3. Add to the local scheduler
    let targetChannelId = channelId
    if (!targetChannelId || targetChannelId === 'current') {
      targetChannelId = channel?.id || context.channelId || 'dm'
    }
    if (targetChannelId === 'terminal' || targetChannelId.startsWith('cli_') || targetChannelId.startsWith('web_')) {
      targetChannelId = 'dm'
    }

    let targetGuildId = context.guild?.id || context.guildId || null
    if (!targetGuildId && targetChannelId && targetChannelId !== 'dm') {
      const chan = bot?.channels?.cache?.get ? bot.channels.cache.get(targetChannelId) : null
      if (chan && chan.guildId) {
        targetGuildId = chan.guildId
      }
    }
    const task = agentScheduler.add({
      description,
      scheduledAt,
      userId: context.user?.id || context.userId || null,
      guildId: targetGuildId,
      channelId: targetChannelId,
      repeat: ['hourly', 'daily', 'weekly'].includes(repeat) ? repeat : null,
      action: taskAction,
      params: taskParams,
      createdBy: context.user?.username || 'chat_agent'
    })

    const timeString = new Date(scheduledAt).toLocaleString()
    const repeatString = task.repeat ? ` (repeating ${task.repeat})` : ''
    const targetDisplay = (targetChannelId === 'dm' || !targetChannelId)
      ? 'Direct Message / All Channels'
      : `<#${targetChannelId}>`

    // 3. Confirm back to user
    const response = '✅ **Task Scheduled Successfully!**\n' +
                         `**ID:** \`${task.id}\`\n` +
                         `**Task:** ${description}\n` +
                         `**Target:** ${targetDisplay}\n` +
                         `**Time:** ${timeString}${repeatString}`

    if (context && typeof context.reply === 'function' && !context.replied) {
      await context.reply(response)
    } else if (channel && typeof channel.send === 'function') {
      await channel.send(response)
    }

    return task
  }
}
