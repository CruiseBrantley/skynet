const tldrCmd = require('../commands/tldr')
const { queryOllamaWithContext, getActiveModelCapabilities } = require('../util/ollama')
const { isFeatureEnabled } = require('../util/config_manager')

jest.mock('../logger')
jest.mock('../util/ollama')
jest.mock('../util/config_manager')

describe('commands/tldr', () => {
  let mockInteraction

  beforeEach(() => {
    jest.clearAllMocks()
    isFeatureEnabled.mockReturnValue(true)
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
        getString: jest.fn().mockReturnValue(null)
      },
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      reply: jest.fn().mockResolvedValue()
    }

    queryOllamaWithContext.mockResolvedValue({
      message: { content: '1. Key Topics: Chatting' }
    })
  })

  test('blocks execution when feature is disabled for guild', async () => {
    isFeatureEnabled.mockReturnValue(false)
    await tldrCmd.execute(mockInteraction)

    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('disabled'),
      ephemeral: true
    }))
  })

  test('fetches messages and posts channel summary embed', async () => {
    await tldrCmd.execute(mockInteraction)

    expect(mockInteraction.deferReply).toHaveBeenCalled()
    expect(mockInteraction.channel.messages.fetch).toHaveBeenCalledWith({ limit: 20 })
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }))
  })
})
