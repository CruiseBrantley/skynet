const linkSummarize = require('../events/linkSummarize')
const { summarizeUrl } = require('../util/summarize')

jest.mock('../logger')
jest.mock('../firebase-login', () => {
  const mockRef = {
    once: jest.fn(() => Promise.resolve({
      exists: () => true,
      val: () => true
    }))
  }
  const mockDb = {
    ref: jest.fn(() => mockRef)
  }
  return jest.fn(() => mockDb)
})
jest.mock('../util/summarize', () => ({
  ...jest.requireActual('../util/summarize'),
  summarizeUrl: jest.fn()
}))
jest.mock('../util/ollama', () => ({
  queryLocalOrRemote: jest.fn().mockResolvedValue({
    message: { content: 'YES' }
  })
}))

describe('Link Summarize Event', () => {
  let mockBot
  let mockMessage
  let eventHandler

  beforeEach(() => {
    jest.clearAllMocks()
    if (typeof linkSummarize._resetCache === 'function') {
      linkSummarize._resetCache()
    }
    mockBot = {
      user: { id: 'bot_123' },
      on: jest.fn((event, handler) => {
        if (event === 'messageCreate') eventHandler = handler
      })
    }

    mockMessage = {
      id: 'msg_1',
      author: { bot: false },
      guild: { id: 'guild_123' },
      guildId: 'guild_123',
      createdAt: new Date(),
      channelId: process.env.TEST_CHANNEL || '558430903072718868',
      content: 'Check this: https://example.com',
      mentions: {
        has: jest.fn(() => false)
      },
      channel: { sendTyping: jest.fn(), isThread: jest.fn(() => false) },
      reply: jest.fn().mockResolvedValue()
    }

    linkSummarize(mockBot)
  })

  test('skips summarization if the bot is mentioned', async () => {
    mockMessage.mentions.has.mockReturnValue(true)

    await eventHandler(mockMessage)

    expect(summarizeUrl).not.toHaveBeenCalled()
    expect(mockMessage.reply).not.toHaveBeenCalled()
  })

  test('processes summarization if the bot is NOT mentioned', async () => {
    mockMessage.mentions.has.mockReturnValue(false)
    summarizeUrl.mockResolvedValue('Excellent article summary.')

    await eventHandler(mockMessage)

    expect(summarizeUrl).toHaveBeenCalledWith('https://example.com', false)
    expect(mockMessage.reply).toHaveBeenCalled()
  })

  test('skips summarization if channel is a thread', async () => {
    mockMessage.channel.isThread = jest.fn(() => true)

    await eventHandler(mockMessage)

    expect(summarizeUrl).not.toHaveBeenCalled()
    expect(mockMessage.reply).not.toHaveBeenCalled()
  })

  test('skips duplicate summarization of the same URL in the same channel', async () => {
    summarizeUrl.mockResolvedValue('Excellent article summary.')

    await eventHandler(mockMessage)
    expect(summarizeUrl).toHaveBeenCalledTimes(1)

    // Second message with different message ID but same URL in same channel
    const msg2 = { ...mockMessage, id: 'msg_2', channel: { sendTyping: jest.fn(), isThread: jest.fn(() => false) }, reply: jest.fn() }
    await eventHandler(msg2)
    expect(summarizeUrl).toHaveBeenCalledTimes(1)
  })

  test('skips if message is from a bot', async () => {
    mockMessage.author.bot = true

    await eventHandler(mockMessage)

    expect(summarizeUrl).not.toHaveBeenCalled()
  })

  test('skips if no URL is present', async () => {
    mockMessage.content = 'No link here'

    await eventHandler(mockMessage)

    expect(summarizeUrl).not.toHaveBeenCalled()
  })
})
