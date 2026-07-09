const logger = require('../../logger')
const { getReactions, addReaction, pruneCache } = require('./reactionCache')

/**
 * Formats a collection of Discord messages into the role-based format Skynet expects.
 * Includes Message IDs to enable the AI to target them with actions like reactions.
 */
async function formatMessagesForContext (messages, botId) {
  // Collect from oldest to newest
  const sorted = Array.from(messages.values()).sort((a, b) => a.createdAt - b.createdAt)
  const activeMessageIds = sorted.map(m => m.id)

  // Prune the cache to keep it clean and bounded to active messages
  pruneCache(activeMessageIds)

  const formatted = []
  for (const m of sorted) {
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

    // Add reactions awareness if available
    let reactionsLabel = ''
    if (m.reactions && m.reactions.cache && m.reactions.cache.size > 0) {
      const reactionStrings = []
      for (const reaction of m.reactions.cache.values()) {
        const emojiKey = reaction.emoji.id ? `${reaction.emoji.name}:${reaction.emoji.id}` : reaction.emoji.name

        let reactors = getReactions(m.id)?.get(emojiKey)

        if (!reactors) {
          // Lazy fetch reactors from Discord API (only done once per message reaction)
          try {
            if (reaction.users && typeof reaction.users.fetch === 'function') {
              const users = await reaction.users.fetch()
              for (const user of users.values()) {
                addReaction(m.id, emojiKey, user.username)
              }
              reactors = getReactions(m.id)?.get(emojiKey)
            }
          } catch (fetchErr) {
            logger.warn(`Failed to lazy-fetch reaction users for message ${m.id}: ${fetchErr.message}`)
          }
        }

        const count = reaction.count
        if (reactors && reactors.size > 0) {
          const names = [...reactors].map(name => `@${name}`).join(', ')
          reactionStrings.push(`${reaction.emoji.name} (x${count} from ${names})`)
        } else {
          reactionStrings.push(`${reaction.emoji.name} (x${count})`)
        }
      }

      if (reactionStrings.length > 0) {
        reactionsLabel = ` [Reactions: ${reactionStrings.join(', ')}]`
      }
    }

    formatted.push({ role, content: `[ID: ${m.id} | ${timeLabel}]${reactionsLabel} ${handle}: ${content}` })
  }

  return formatted.filter(m => m.content.length > 0)
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
    return await formatMessagesForContext(filtered, botId)
  } catch (err) {
    logger.warn(`Failed to fetch context for channel ${channel.id}: ${err.message}`)
    return []
  }
}

module.exports = { formatMessagesForContext, fetchAndFormatContext }
