const logger = require('../../logger')

module.exports = {
  name: 'pin_message',
  description: 'Pins a Discord message to the channel pins list by its Snowflake message ID.',
  schema: {
    message_id: {
      type: 'string',
      description: 'The Snowflake ID of the message to pin.'
    },
    channel_id: {
      type: 'string',
      description: 'Optional Snowflake ID of the channel containing the message (defaults to current channel).'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const messageId = (params.message_id || params.messageId || '').trim()
    if (!messageId) {
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
        logger.warn(`pin_message: Failed to fetch message ${messageId}: ${err.message}`)
        return null
      })

      if (!message) {
        return { success: false, error: `Message with ID "${messageId}" could not be found.` }
      }

      await message.pin()
      logger.info(`pin_message: Pinned message ${messageId} in channel ${targetChannel.id}`)

      return {
        success: true,
        messageId,
        channelId: targetChannel.id,
        pinned: true
      }
    } catch (err) {
      logger.error(`pin_message failed: ${err.message}`)
      return { success: false, error: `Failed to pin message: ${err.message}` }
    }
  }
}
