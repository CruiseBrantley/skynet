const logger = require('../../logger')

/**
 * Formats a collection of Discord messages into the role-based format Skynet expects.
 * Includes Message IDs to enable the AI to target them with actions like reactions.
 */
function formatMessagesForContext (messages, botId) {
  // Collect from oldest to newest
  const sorted = Array.from(messages.values()).sort((a, b) => a.createdAt - b.createdAt)

  return sorted
    .map(m => {
      const elapsed = Date.now() - m.createdAt.getTime()
      const elapsedMinutes = Math.floor(elapsed / 60000)
      let timeLabel
      if (elapsedMinutes < 1) timeLabel = 'just now'
      else if (elapsedMinutes < 60) timeLabel = `${elapsedMinutes}m ago`
      else if (elapsedMinutes < 1440) timeLabel = `${Math.floor(elapsedMinutes / 60)}h ago`
      else timeLabel = `${Math.floor(elapsedMinutes / 1440)}d ago`

      const role = m.author.id === botId ? 'assistant' : 'user'
      const handle = `@${m.author.username}`
      let content = (m.content || '').replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim()

      // Add image awareness for text-only models
      if (m.attachments && m.attachments.size > 0) {
        const hasImage = m.attachments.some(a => a.contentType?.startsWith('image/'))
        if (hasImage) {
          content = `[Attached Image] ${content}`.trim()
        }
      }

      return { role, content: `[ID: ${m.id} | ${timeLabel}] ${handle}: ${content}` }
    })
    .filter(m => m.content.length > 0)
}

/**
 * Fetches the last N messages from a channel and formats them.
 */
async function fetchAndFormatContext (channel, botId, limit = 50, excludeId = null) {
  try {
    const fetched = await channel.messages.fetch({ limit })
    let filtered = Array.from(fetched.values())
    if (excludeId) {
      filtered = filtered.filter(m => m.id !== excludeId)
    }
    return formatMessagesForContext(filtered, botId)
  } catch (err) {
    logger.warn(`Failed to fetch context for channel ${channel.id}: ${err.message}`)
    return []
  }
}

module.exports = { formatMessagesForContext, fetchAndFormatContext }
