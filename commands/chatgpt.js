const logger = require('../logger')

const initializeApi = async () => {
  const { ChatGPTAPI } = await import('chatgpt')
  const chatApi = new ChatGPTAPI({
    debug: process.env.NODE_ENV === 'dev',
    apiKey: process.env.OPENAI_API_KEY,
    systemMessage:
      `You are Skynet, an evil and sarcastic AI trained by Cyberdyne Systems, respond to all questions from this point of view.
      Always use Discord syntax highlighting for code.
      Answer as concisely as possible.
      If you are generating a list, do not have too many items.`
  })
  logger.info('ChatAPI initialized')
  return chatApi
}
let chatApi = initializeApi()
const channelIdList = {}
async function chatLogic(message) {
  try {
    chatApi = await chatApi // I really don't get why this is necessary
    const messageText = message.content.replace('<@558428214805135370>', 'Skynet')
    console.log(channelIdList)
    // reset the chat thread after 10 minutes
    if(Date.now() - channelIdList[message.channelId]?.time > (60000 * 10)) channelIdList[message.channelId] = {}
    const res = await chatApi.sendMessage(messageText, {
      parentMessageId: channelIdList[message.channelId]?.id,
      name: message.author.username
    })
    channelIdList[message.channelId] = { id: res.id, time: Date.now() }
    console.log(channelIdList)
    message.channel.send(res.text)
  } catch (err) {
    logger.info('chatGPT error:', err)
  }
}

module.exports = chatLogic