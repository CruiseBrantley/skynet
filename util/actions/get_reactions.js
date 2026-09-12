const logger = require('../../logger')

module.exports = {
  name: 'get_reactions',
  description: 'Fetches reactions and the list of users who reacted to a specific message in a channel.',
  schema: {
    message_id: {
      type: 'string',
      description: 'The Snowflake ID of the message to inspect.'
    },
    channel_id: {
      type: 'string',
      description: 'Optional Snowflake ID of the channel containing the message (defaults to current channel).'
    },
    emoji: {
      type: 'string',
      description: 'Optional emoji filter to only retrieve users for a specific emoji reaction.'
    },
    limit: {
      type: 'number',
      description: 'Max users to fetch per reaction (default: 25, max: 100).'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const messageId = params.message_id
    const emoji = params.emoji
    if (!messageId) {
      return { success: false, error: 'Missing required parameter: message_id' }
    }

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

      const message = await targetChannel.messages.fetch(messageId).catch(() => null)
      if (!message) {
        return { success: false, error: `Message with ID "${messageId}" not found.` }
      }

      const limit = Math.min(Math.max(parseInt(params.limit) || 25, 1), 100)
      const results = []

      for (const [, reaction] of message.reactions.cache) {
        const emojiIdentifier = reaction.emoji.name || reaction.emoji.id
        if (emoji && emoji !== emojiIdentifier && emoji !== reaction.emoji.toString()) {
          continue
        }

        const users = await reaction.users.fetch({ limit }).catch(() => new Map())
        const userList = Array.from(users.values()).map(u => ({
          id: u.id,
          username: u.username,
          bot: u.bot
        }))

        results.push({
          emoji: reaction.emoji.name,
          emojiId: reaction.emoji.id || null,
          isCustom: Boolean(reaction.emoji.id),
          count: reaction.count,
          users: userList
        })
      }

      return {
        success: true,
        messageId: message.id,
        channelId: targetChannel.id,
        reactionCount: results.length,
        reactions: results
      }
    } catch (err) {
      logger.error(`get_reactions failed: ${err.message}`)
      return { success: false, error: `Failed to fetch reactions: ${err.message}` }
    }
  }
}
