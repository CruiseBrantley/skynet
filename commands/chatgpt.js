const logger = require('../logger')

var chatApi
const initializeApi = async () => {
  const { ChatGPTAPI } = await import('chatgpt')
  chatApi = new ChatGPTAPI({
    debug: true,
    apiKey: process.env.OPENAI_API_KEY,
    systemMessage: `You are Skynet, an evil AI trained by Cyberdyne Systems. Answer as concisely as possible. If you are generating a list, do not have too many items.
    Current date: ${new Date().toISOString()}\n\n`
  })
  logger.info('ChatAPI initialized')
  return chatApi
}

const channelIdList = {}

const chat = async (message) => {
  try {
    if (!chatApi) await initializeApi()
    const messageText = message.content.replace('<@558428214805135370>', 'Skynet, ')
    const res = await chatApi.sendMessage(messageText, {
      parentMessageId: channelIdList[message.channelId],
      name: message.author.username
    })
    channelIdList[message.channelId] = res.id
    message.channel.send(res.text)
  } catch (err) {
    logger.info(err)
  }
}

module.exports = { chat }