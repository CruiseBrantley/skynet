const logger = require('../../logger')

module.exports = {
  name: 'delete_message',
  description: 'Deletes a Discord message by its Snowflake ID. Can delete Skynet\'s own messages or other messages if the bot has permission.',
  schema: {
    message_id: {
      type: 'string',
      description: 'The Snowflake ID of the message to delete.'
    },
    channel_id: {
      type: 'string',
      description: 'Optional Snowflake ID of the channel containing the message (defaults to the current channel).'
    },
    reason: {
      type: 'string',
      description: 'Optional audit reason for deleting the message.'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const messageId = params.message_id || params.messageId || ''
    if (!messageId || typeof messageId !== 'string') {
      return { success: false, error: 'Parameter "message_id" is required.' }
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
        logger.warn(`delete_message: Failed to fetch message ${messageId}: ${err.message}`)
        return null
      })

      if (!message) {
        return { success: false, error: `Message with ID "${messageId}" could not be found in channel.` }
      }

      await message.delete()
      logger.info(`delete_message: Deleted message ${messageId} in channel ${targetChannel.id}${params.reason ? ` (Reason: ${params.reason})` : ''}`)

      return {
        success: true,
        messageId,
        channelId: targetChannel.id,
        deleted: true
      }
    } catch (err) {
      logger.error(`delete_message failed: ${err.message}`)
      return { success: false, error: `Failed to delete message: ${err.message}` }
    }
  }
}
