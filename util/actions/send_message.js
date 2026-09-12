module.exports = {
  name: 'send_message',
  description: 'Sends a plain text message to a channel or DM. Returns the sent messageId.',
  schema: {
    content: {
      type: 'string',
      description: 'The message text to send.'
    },
    channel_id: {
      type: 'string',
      description: 'Optional Snowflake ID of the target channel (defaults to current channel).'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const client = bot?.client || bot
    let targetChannel = channel

    if (params.channel_id && client?.channels) {
      targetChannel = client.channels.cache?.get(params.channel_id) ||
        (await client.channels.fetch(params.channel_id).catch(() => null)) ||
        channel
    }

    if (!targetChannel || typeof targetChannel.send !== 'function') {
      return { success: false, error: 'Target channel not accessible or lacks send capability.' }
    }

    const content = params.content !== undefined ? params.content : (params.message || '')
    const sent = await targetChannel.send({ content: String(content) })

    return {
      success: true,
      messageId: sent?.id || null,
      channelId: targetChannel.id || null
    }
  }
}
