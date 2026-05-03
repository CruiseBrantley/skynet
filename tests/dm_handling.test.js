const chatCommand = require('../commands/chat')
const { queryOllamaWithContext } = require('../util/ollama')
const logger = require('../logger')

jest.mock('../util/ollama')
jest.mock('../logger')
jest.mock('../util/chat/contextHelper', () => ({
  fetchAndFormatContext: jest.fn().mockResolvedValue([])
}))

describe('DM Handling Regression', () => {
  let mockInteraction

  beforeEach(() => {
    jest.clearAllMocks()
    mockInteraction = {
      id: 'dm-123',
      user: { id: 'user-1', username: 'testuser' },
      member: null,
      guild: null,
      guildId: null,
      channelId: 'dm-channel-1',
      channel: {
        id: 'dm-channel-1',
        type: undefined, // Simulate partial channel
        sendTyping: jest.fn(),
        messages: {
          fetch: jest.fn().mockResolvedValue(Object.assign(new Map(), {
            map: function(fn) { return Array.from(this.values()).map(fn) }
          }))
        }
      },
      options: {
        getString: jest.fn().mockReturnValue('Hello bot'),
        getAttachment: jest.fn().mockReturnValue(null)
      },
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      client: {
        user: { id: 'bot-123', username: 'Skynet' },
        commands: Object.assign(new Map(), {
          map: function(fn) { return Array.from(this.values()).map(fn) }
        })
      }
    }
  })

  test('responds to a DM even if it is the first interaction (no history)', async () => {
    queryOllamaWithContext.mockResolvedValue({
      message: { role: 'assistant', content: 'Hello there! How can I help?' }
    })

    await chatCommand.execute(mockInteraction)

    expect(mockInteraction.deferReply).toHaveBeenCalled()
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Hello there')
    }))
  })
})
