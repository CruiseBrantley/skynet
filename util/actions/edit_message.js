const logger = require('../../logger')

module.exports = {
  name: 'edit_message',
  description: 'Edits an existing Discord message previously sent by Skynet. Requires message_id and new content.',
  schema: {
    message_id: {
      type: 'string',
      description: 'The Snowflake ID of the message to edit.'
    },
    content: {
      type: 'string',
      description: 'The new message text content.'
    },
    channel_id: {
      type: 'string',
      description: 'Optional Snowflake ID of the channel containing the message (defaults to the current channel).'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const messageId = params.message_id || params.messageId || ''
    const content = params.content !== undefined ? params.content : (params.message || '')

    if (!messageId || typeof messageId !== 'string') {
      return { success: false, error: 'Parameter "message_id" is required.' }
    }
    if (!content || typeof content !== 'string') {
      return { success: false, error: 'Parameter "content" is required.' }
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

      const message = await targetChannel.messages.fetch(messageId).catch((err) => {
        logger.warn(`edit_message: Failed to fetch message ${messageId}: ${err.message}`)
        return null
      })

      if (!message) {
        return { success: false, error: `Message with ID "${messageId}" could not be found in channel.` }
      }

      if (client?.user && message.author?.id && message.author.id !== client.user.id) {
        return { success: false, error: 'Permission denied: Skynet can only edit messages authored by itself.' }
      }

      const updated = await message.edit({ content })
      logger.info(`edit_message: Edited message ${messageId} in channel ${targetChannel.id}`)

      return {
        success: true,
        messageId: updated.id,
        channelId: targetChannel.id,
        content: updated.content
      }
    } catch (err) {
      logger.error(`edit_message failed: ${err.message}`)
      return { success: false, error: `Failed to edit message: ${err.message}` }
    }
  }
}
