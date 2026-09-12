const logger = require('../../logger')

module.exports = {
  name: 'fetch_messages',
  description: 'Fetches historical messages from a Discord channel or DM. Returns structured message records including author, text content, timestamp, and attachments.',
  schema: {
    channel_id: {
      type: 'string',
      description: 'Optional Snowflake ID of the channel to inspect (defaults to current channel).'
    },
    limit: {
      type: 'number',
      description: 'Number of messages to retrieve (default: 20, min: 1, max: 100).'
    },
    before: {
      type: 'string',
      description: 'Optional Snowflake message ID: fetch messages posted before this ID.'
    },
    after: {
      type: 'string',
      description: 'Optional Snowflake message ID: fetch messages posted after this ID.'
    },
    around: {
      type: 'string',
      description: 'Optional Snowflake message ID: fetch messages surrounding this ID.'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const limit = Math.min(Math.max(parseInt(params.limit) || 20, 1), 100)

    try {
      const client = bot?.client || bot
      let targetChannel = channel

      if (params.channel_id && client?.channels) {
        targetChannel = client.channels.cache?.get(params.channel_id) ||
          (await client.channels.fetch(params.channel_id).catch(() => null)) ||
          channel
      }

      if (!targetChannel || typeof targetChannel.messages?.fetch !== 'function') {
        return { success: false, error: 'Target channel not accessible or lacks message fetching capability.' }
      }

      const fetchOptions = { limit }
      if (params.before) fetchOptions.before = String(params.before)
      if (params.after) fetchOptions.after = String(params.after)
      if (params.around) fetchOptions.around = String(params.around)

      logger.info(`fetch_messages: Fetching up to ${limit} messages from channel ${targetChannel.id}`)
      const fetched = await targetChannel.messages.fetch(fetchOptions)
      const messageList = Array.from(fetched && typeof fetched.values === 'function' ? fetched.values() : (Array.isArray(fetched) ? fetched : []))

      const formatted = messageList.map(msg => {
        let createdAtIso = null
        if (msg.createdAt && typeof msg.createdAt.toISOString === 'function') {
          createdAtIso = msg.createdAt.toISOString()
        } else if (msg.createdTimestamp) {
          createdAtIso = new Date(msg.createdTimestamp).toISOString()
        }

        let attachments = []
        if (msg.attachments && typeof msg.attachments.values === 'function') {
          attachments = Array.from(msg.attachments.values()).map(att => ({
            id: att.id,
            name: att.name,
            url: att.url,
            contentType: att.contentType || null
          }))
        }

        return {
          id: msg.id,
          author: {
            id: msg.author?.id || null,
            username: msg.author?.username || 'Unknown',
            bot: Boolean(msg.author?.bot)
          },
          content: msg.content || '',
          createdAt: createdAtIso,
          attachments,
          embedsCount: Array.isArray(msg.embeds) ? msg.embeds.length : 0
        }
      })

      return {
        success: true,
        channelId: targetChannel.id,
        count: formatted.length,
        messages: formatted
      }
    } catch (err) {
      logger.error(`fetch_messages failed: ${err.message}`)
      return { success: false, error: `Failed to fetch messages: ${err.message}` }
    }
  }
}
