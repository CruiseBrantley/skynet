const smartPollCmd = require('../commands/smart_poll')
const { queryOllamaWithContext, getActiveModelCapabilities } = require('../util/ollama')
const { isFeatureEnabled } = require('../util/config_manager')

jest.mock('../logger')
jest.mock('../util/ollama')
jest.mock('../util/config_manager')

describe('commands/smart_poll', () => {
  let mockInteraction

  beforeEach(() => {
    jest.clearAllMocks()
    isFeatureEnabled.mockReturnValue(true)
    getActiveModelCapabilities.mockResolvedValue({
      tier: 'remote_5090',
      maxDigestMessages: 20
    })

    const fakeMessage = {
      author: { username: 'testuser', bot: false },
      content: 'Should we play Valheim or Core Keeper tonight?',
      createdTimestamp: Date.now()
    }

    mockInteraction = {
      guildId: 'guild123',
      user: { id: 'user123', username: 'testuser' },
      channel: {
        name: 'gaming',
        messages: {
          fetch: jest.fn().mockResolvedValue(new Map([['1', fakeMessage]]))
        },
        send: jest.fn().mockResolvedValue()
      },
      options: {
        getString: jest.fn().mockReturnValue('Game Night Vote')
      },
      deferReply: jest.fn().mockResolvedValue(),
      deleteReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      reply: jest.fn().mockResolvedValue()
    }

    queryOllamaWithContext.mockResolvedValue({
      message: {
        content: JSON.stringify({
          question: 'What game should we play tonight?',
          options: ['Valheim', 'Core Keeper']
        })
      }
    })
  })

  test('blocks execution when feature is disabled for guild', async () => {
    isFeatureEnabled.mockReturnValue(false)
    await smartPollCmd.execute(mockInteraction)

    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('disabled'),
      ephemeral: true
    }))
  })

  test('synthesizes discussion and posts native Discord poll', async () => {
    await smartPollCmd.execute(mockInteraction)

    expect(mockInteraction.deferReply).toHaveBeenCalled()
    expect(mockInteraction.channel.send).toHaveBeenCalledWith(expect.objectContaining({
      poll: expect.objectContaining({
        question: { text: 'What game should we play tonight?' },
        answers: [{ text: 'Valheim' }, { text: 'Core Keeper' }]
      })
    }))
  })
})
