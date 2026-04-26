module.exports = {
  name: 'send_message',
  description: 'Sends a plain text message to a channel or DM',
  schema: {
    content: 'string — the message text to send'
  },
  execute: async (bot, channel, params) => {
    await channel.send({ content: params.content || params.message || '' })
  }
}
