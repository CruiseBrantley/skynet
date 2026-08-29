const tldrCmd = require('../commands/tldr')
const { queryOllamaWithContext, getActiveModelCapabilities } = require('../util/ollama')

jest.mock('../logger')
jest.mock('../util/ollama')

describe('commands/tldr', () => {
  let mockInteraction

  beforeEach(() => {
    jest.clearAllMocks()
    getActiveModelCapabilities.mockResolvedValue({
      tier: 'remote_5090',
      maxDigestMessages: 100
    })

    const fakeMessage = {
      author: { username: 'testuser', bot: false },
      content: 'Hello world chat message',
      createdTimestamp: Date.now()
    }

    mockInteraction = {
      guildId: 'guild123',
      user: { id: 'user123', username: 'testuser' },
      channel: {
        name: 'general',
        messages: {
          fetch: jest.fn().mockResolvedValue(new Map([['1', fakeMessage]]))
        }
      },
      options: {
        getInteger: jest.fn().mockReturnValue(20),
        getString: jest.fn().mockReturnValue(null),
        getBoolean: jest.fn().mockReturnValue(false)
      },
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      reply: jest.fn().mockResolvedValue()
    }

    queryOllamaWithContext.mockResolvedValue({
      message: { content: '1. Key Topics: Chatting' }
    })
  })

  test('fetches messages and posts channel summary embed for current day', async () => {
    await tldrCmd.execute(mockInteraction)

    expect(mockInteraction.deferReply).toHaveBeenCalled()
    expect(mockInteraction.channel.messages.fetch).toHaveBeenCalledWith({ limit: 20 })
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }))
  })

  test('filters out messages from prior days when all_days is false by default', async () => {
    const yesterdayMessage = {
      author: { username: 'olduser', bot: false },
      content: 'Yesterday message',
      createdTimestamp: Date.now() - 24 * 60 * 60 * 1000 * 2 // 2 days ago
    }

    mockInteraction.channel.messages.fetch.mockResolvedValue(new Map([['2', yesterdayMessage]]))

    await tldrCmd.execute(mockInteraction)

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: 'No messages found from today in this channel to summarize. Use `/tldr all_days:true` to include prior days.'
    })
  })

  test('includes prior day messages when all_days is true', async () => {
    const yesterdayMessage = {
      author: { username: 'olduser', bot: false },
      content: 'Yesterday message',
      createdTimestamp: Date.now() - 24 * 60 * 60 * 1000 * 2
    }

    mockInteraction.options.getBoolean.mockReturnValue(true)
    mockInteraction.channel.messages.fetch.mockResolvedValue(new Map([['2', yesterdayMessage]]))

    await tldrCmd.execute(mockInteraction)

    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }))
  })
})
