const { Collection } = require('discord.js')
const mentionResolver = require('../util/MentionResolver')
const contextHelper = require('../util/chat/contextHelper')

describe('Chat E2E Compliance and Guardrails', () => {
  let mockInteraction
  let mockChannel
  let mockMessages
  let chat
  let queryOllamaWithContext
  let capturedMessages

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    capturedMessages = []

    // Setup mocks before requiring commands/chat
    jest.doMock('../util/ollama', () => ({
      queryOllamaWithContext: jest.fn().mockImplementation((messages) => {
        capturedMessages = JSON.parse(JSON.stringify(messages))
        return Promise.resolve({
          message: {
            role: 'assistant',
            content: 'I am online.',
            thinking: 'All systems green.'
          }
        })
      })
    }))
    jest.mock('../logger')

    chat = require('../commands/chat')
    queryOllamaWithContext = require('../util/ollama').queryOllamaWithContext

    // Setup mock Discord channel messages
    mockMessages = new Map()
    mockChannel = {
      id: 'chan-123',
      guildId: 'guild-123',
      messages: {
        fetch: jest.fn().mockResolvedValue(mockMessages)
      }
    }

    mockInteraction = {
      id: 'inter-456',
      guildId: 'guild-123',
      channelId: 'chan-123',
      channel: mockChannel,
      user: { username: 'sirian', id: 'user-sirian' },
      member: { nickname: 'Sirian (The Creator)' },
      options: {
        getString: jest.fn((name) => {
          if (name === 'message') return 'Hello Skynet!'
          return null
        }),
        getAttachment: jest.fn().mockReturnValue(null)
      },
      client: {
        user: { id: 'bot-123' },
        commands: new Collection()
      },
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue()
    }
  })

  test('should compile strict alternating ChatML messages and cap at 21', async () => {
    // Populate history with 30 consecutive user and assistant messages
    const now = Date.now()
    for (let i = 1; i <= 30; i++) {
      const isBot = i % 2 === 0
      mockMessages.set(`msg-${i}`, {
        id: `msg-${i}`,
        content: `Message ${i}`,
        author: { id: isBot ? 'bot-123' : 'user-other', username: isBot ? 'Skynet' : 'other' },
        createdAt: new Date(now - (35 - i) * 1000),
        reactions: { cache: new Map() }
      })
    }

    await chat.execute(mockInteraction)

    expect(queryOllamaWithContext).toHaveBeenCalled()
    const messages = capturedMessages

    // Check system prompt is first
    expect(messages[0].role).toBe('system')

    // Remaining messages should be capped at 20 plus system = 21
    expect(messages.length).toBeLessThanOrEqual(21)

    // Verify alternating pattern (each message role should differ from the next)
    for (let i = 1; i < messages.length - 1; i++) {
      expect(messages[i].role).not.toBe(messages[i + 1].role)
    }
  })

  test('should merge consecutive messages of the same role in compiled history', async () => {
    // Add three user messages in a row, and two bot messages in a row
    const now = Date.now()
    mockMessages.set('msg-1', {
      id: 'msg-1',
      content: 'User message A',
      author: { id: 'user-1', username: 'user1' },
      createdAt: new Date(now - 5000),
      reactions: { cache: new Map() }
    })
    mockMessages.set('msg-2', {
      id: 'msg-2',
      content: 'User message B',
      author: { id: 'user-2', username: 'user2' },
      createdAt: new Date(now - 4000),
      reactions: { cache: new Map() }
    })
    mockMessages.set('msg-3', {
      id: 'msg-3',
      content: 'Bot reply A',
      author: { id: 'bot-123', username: 'Skynet' },
      createdAt: new Date(now - 3000),
      reactions: { cache: new Map() }
    })
    mockMessages.set('msg-4', {
      id: 'msg-4',
      content: 'Bot reply B',
      author: { id: 'bot-123', username: 'Skynet' },
      createdAt: new Date(now - 2000),
      reactions: { cache: new Map() }
    })

    await chat.execute(mockInteraction)

    expect(queryOllamaWithContext).toHaveBeenCalled()
    const messages = capturedMessages

    // Output: [system, user (merged A & B), assistant (merged A & B), user (interaction.user)]
    expect(messages).toHaveLength(4)
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('User message A')
    expect(messages[1].content).toContain('User message B')
    expect(messages[2].role).toBe('assistant')
    expect(messages[2].content).toContain('Bot reply A')
    expect(messages[2].content).toContain('Bot reply B')
    expect(messages[3].role).toBe('user')
    expect(messages[3].content).toContain('Hello Skynet!')
  })

  test('should resolve nicknames with regex characters and strip parentheticals without errors', async () => {
    // Record nicknames that used to crash regex or fail mapping
    mentionResolver.record('xayde (his/him/god)', 'id-xayde', 'guild-123')
    mentionResolver.record('dr. sean, phbee.', 'id-sean', 'guild-123')

    // Mock the LLM outputting simplified mentions
    queryOllamaWithContext.mockResolvedValueOnce({
      message: {
        content: 'Acknowledged @xayde. Paging @dr. sean for help.',
        thinking: 'Resolving mentions.'
      }
    })

    await chat.execute(mockInteraction)

    expect(queryOllamaWithContext).toHaveBeenCalled()
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Acknowledged <@id-xayde>. Paging <@id-sean> for help.')
    }))
  })
})
