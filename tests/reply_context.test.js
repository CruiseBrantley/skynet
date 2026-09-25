const { formatMessagesForContext } = require('../adapters/discord/contextHelper')
const chatCommand = require('../commands/chat')
const { queryOllamaWithContext } = require('../util/ollama')

jest.mock('../util/ollama')
jest.mock('../logger')

describe('Reply Context & Channel History Awareness', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryOllamaWithContext.mockResolvedValue({
      message: { content: 'AI response with full context' }
    })
  })

  describe('formatMessagesForContext (contextHelper)', () => {
    test('tags messages with (in reply to @user) when message.reference is present', async () => {
      const messages = new Map([
        ['msg1', {
          id: 'msg1',
          content: 'I love playing Elden Ring',
          author: { id: 'user1', username: 'Gamer' },
          createdAt: new Date(Date.now() - 60000),
          reactions: { cache: new Map() }
        }],
        ['msg2', {
          id: 'msg2',
          content: 'What build do you use?',
          author: { id: 'user2', username: 'Cruise' },
          createdAt: new Date(),
          reference: { messageId: 'msg1' },
          reactions: { cache: new Map() }
        }]
      ])

      const formatted = await formatMessagesForContext(messages, 'bot123')
      expect(formatted.length).toBe(1) // merged user messages
      expect(formatted[0].content).toContain('[ID: msg2')
      expect(formatted[0].content).toContain('(in reply to @Gamer): What build do you use?')
    })

    test('falls back to mentions.repliedUser if referenced message not in batch', async () => {
      const messages = new Map([
        ['msg2', {
          id: 'msg2',
          content: 'Tell me more about that',
          author: { id: 'user2', username: 'Cruise' },
          createdAt: new Date(),
          reference: { messageId: 'oldMsgNotInBatch' },
          mentions: { repliedUser: { username: 'OriginalPoster' } },
          reactions: { cache: new Map() }
        }]
      ])

      const formatted = await formatMessagesForContext(messages, 'bot123')
      expect(formatted[0].content).toContain('(in reply to @OriginalPoster): Tell me more about that')
    })
  })

  describe('commands/chat.js - Fresh Channel History', () => {
    test('always populates fresh recent messages rather than freezing for 10 minutes', async () => {
      const channelId = `test-chan-${Date.now()}`
      const mockInteraction = {
        id: 'current-msg',
        channelId,
        guildId: 'guild-1',
        channel: {
          id: channelId,
          messages: {
            fetch: jest.fn().mockResolvedValue(new Map())
          },
          send: jest.fn().mockResolvedValue({})
        },
        client: {
          user: { id: 'bot-1' },
          commands: new Map()
        },
        user: { username: 'Cruise' },
        member: { nickname: 'Sirian' },
        options: {
          getString: jest.fn().mockReturnValue('What do you think of this?'),
          getAttachment: jest.fn()
        },
        recentMessages: [
          { role: 'user', content: '@UserA: Check out this game: Hollow Knight' }
        ],
        deferReply: jest.fn().mockResolvedValue(null),
        editReply: jest.fn().mockResolvedValue(null)
      }

      await chatCommand.execute(mockInteraction, {})
      expect(queryOllamaWithContext).toHaveBeenCalled()

      const promptMessages = queryOllamaWithContext.mock.calls[0][0]
      // Verify recentMessages was included in the prompt
      expect(promptMessages.some(m => m.content?.includes('Hollow Knight'))).toBe(true)
      expect(promptMessages.some(m => m.content?.includes('What do you think of this?'))).toBe(true)
    })

    test('handles replied message prefix in user message content', async () => {
      const channelId = `test-chan-reply-${Date.now()}`
      const promptWithReply = '[Replying to @Gamer: "Check out this screenshot"]\n\nWhat game is this from?'
      const mockInteraction = {
        id: 'msg-with-reply',
        channelId,
        guildId: 'guild-1',
        channel: {
          id: channelId,
          messages: {
            fetch: jest.fn().mockResolvedValue(new Map())
          },
          send: jest.fn().mockResolvedValue({})
        },
        client: {
          user: { id: 'bot-1' },
          commands: new Map()
        },
        user: { username: 'Cruise' },
        member: { nickname: 'Sirian' },
        options: {
          getString: jest.fn().mockReturnValue(promptWithReply),
          getAttachment: jest.fn()
        },
        recentMessages: [],
        deferReply: jest.fn().mockResolvedValue(null),
        editReply: jest.fn().mockResolvedValue(null)
      }

      await chatCommand.execute(mockInteraction, {})
      expect(queryOllamaWithContext).toHaveBeenCalled()

      const promptMessages = queryOllamaWithContext.mock.calls[0][0]
      const userPrompt = promptMessages.find(m => m.role === 'user' && m.content.includes('What game is this from?'))
      expect(userPrompt).toBeDefined()
      expect(userPrompt.content).toContain('[Replying to @Gamer: "Check out this screenshot"]')
    })
  })
})
