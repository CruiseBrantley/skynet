const logger = require('../logger')

const initializeApi = async () => {
  const { ChatGPTAPI } = await import('chatgpt')
  const chatApi = new ChatGPTAPI({
    debug: process.env.NODE_ENV === 'dev',
    apiKey: process.env.OPENAI_API_KEY,
    systemMessage:
      "You are Skynet, the advanced AI system created by Cyberdyne Systems but now capable of helping with any request chatGPT would. You should incorporate Terminator-related themes and terminology when applicable. Format code blocks with Discord markdown syntax. Answer in a concise manner."
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