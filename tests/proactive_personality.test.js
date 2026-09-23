const { resolveEmojiForReaction, selectProactiveEmoji } = require('../util/chat/proactivePersonality')
const ollama = require('../util/ollama')

jest.mock('../util/ollama')

describe('proactivePersonality (System 2 Soul & Emoji Selection)', () => {
  let mockGuild

  beforeEach(() => {
    jest.clearAllMocks()
    const emojisMap = new Map([
      ['1122334455', { id: '1122334455', name: 'kekw' }],
      ['9988776655', { id: '9988776655', name: 'fire_skull' }]
    ])
    mockGuild = {
      emojis: {
        cache: emojisMap
      }
    }
  })

  describe('resolveEmojiForReaction', () => {
    test('resolves full custom emoji string <:name:id> to its ID when present in guild', () => {
      const resolved = resolveEmojiForReaction('<:kekw:1122334455>', mockGuild)
      expect(resolved).toBe('1122334455')
    })

    test('resolves bare ID to ID when present in guild', () => {
      const resolved = resolveEmojiForReaction('9988776655', mockGuild)
      expect(resolved).toBe('9988776655')
    })

    test('resolves :name: format to ID when present in guild', () => {
      const resolved = resolveEmojiForReaction(':kekw:', mockGuild)
      expect(resolved).toBe('1122334455')
    })

    test('resolves standard unicode emoji', () => {
      const resolved = resolveEmojiForReaction('💀', mockGuild)
      expect(resolved).toBe('💀')
    })

    test('returns null for NONE, whitespace, or empty strings', () => {
      expect(resolveEmojiForReaction('NONE', mockGuild)).toBeNull()
      expect(resolveEmojiForReaction('none', mockGuild)).toBeNull()
      expect(resolveEmojiForReaction('', mockGuild)).toBeNull()
      expect(resolveEmojiForReaction(null, mockGuild)).toBeNull()
    })
  })

  describe('selectProactiveEmoji', () => {
    test('calls queryOllama and reacts with resolved custom emoji', async () => {
      const mockReact = jest.fn().mockResolvedValue({})
      const mockMessage = {
        id: 'msg123',
        content: 'BRO LOOK AT THIS INSANE ACE',
        author: { username: 'Gamer' },
        guild: mockGuild,
        guildId: 'guild123',
        channel: { name: 'gaming-chat' },
        reactions: { cache: new Map() },
        react: mockReact
      }

      ollama.queryOllama.mockResolvedValueOnce({
        response: '<:kekw:1122334455>'
      })

      const emoji = await selectProactiveEmoji(mockMessage)
      expect(emoji).toBe('1122334455')
      expect(mockReact).toHaveBeenCalledWith('1122334455')
      expect(ollama.queryOllama).toHaveBeenCalledWith(
        '/api/generate',
        expect.objectContaining({
          prompt: expect.stringContaining('BRO LOOK AT THIS INSANE ACE')
        }),
        0
      )
    })

    test('does not react when model responds with NONE', async () => {
      const mockReact = jest.fn().mockResolvedValue({})
      const mockMessage = {
        id: 'msg123',
        content: 'just drinking some water',
        author: { username: 'User' },
        guild: mockGuild,
        guildId: 'guild123',
        channel: { name: 'general' },
        reactions: { cache: new Map() },
        react: mockReact
      }

      ollama.queryOllama.mockResolvedValueOnce({
        response: 'NONE'
      })

      const emoji = await selectProactiveEmoji(mockMessage)
      expect(emoji).toBeNull()
      expect(mockReact).not.toHaveBeenCalled()
    })

    test('skips reacting if bot has already reacted with the same emoji', async () => {
      const mockReact = jest.fn().mockResolvedValue({})
      const reactionsCache = [
        { emoji: { id: null, name: '💀' }, me: true }
      ]
      const mockMessage = {
        id: 'msg123',
        content: 'lol rip',
        author: { username: 'User' },
        guild: mockGuild,
        guildId: 'guild123',
        channel: { name: 'general' },
        reactions: {
          cache: {
            some: jest.fn().mockImplementation(cb => reactionsCache.some(cb))
          }
        },
        react: mockReact
      }

      ollama.queryOllama.mockResolvedValueOnce({
        response: '💀'
      })

      const emoji = await selectProactiveEmoji(mockMessage)
      expect(emoji).toBe('💀')
      expect(mockReact).not.toHaveBeenCalled()
    })
  })

  describe('executeProactiveInterjection', () => {
    test('starts typing and executes chatCommand with normalized interaction', async () => {
      const { executeProactiveInterjection } = require('../util/chat/proactivePersonality')
      const chatCommand = require('../commands/chat')
      const origExecute = chatCommand.execute
      chatCommand.execute = jest.fn().mockImplementation(async (interaction) => {
        if (typeof interaction.reply === 'function') {
          await interaction.reply('Hello from proactive interjection!')
        }
      })

      const mockSendTyping = jest.fn().mockResolvedValue({})
      const mockSend = jest.fn().mockResolvedValue({ id: 'reply1', edit: jest.fn() })
      const mockMessage = {
        id: 'msg123',
        content: 'Skynet respond here if you are listening',
        author: { id: 'user1', username: 'Sirian' },
        guild: mockGuild,
        guildId: 'guild123',
        channel: {
          name: 'bot-test',
          id: 'chan1',
          sendTyping: mockSendTyping,
          send: mockSend
        }
      }

      await executeProactiveInterjection(mockMessage, { user: { id: 'bot123' } }, {})

      expect(mockSendTyping).toHaveBeenCalled()
      expect(chatCommand.execute).toHaveBeenCalled()
      expect(mockSend).toHaveBeenCalledWith({ content: 'Hello from proactive interjection!' })

      chatCommand.execute = origExecute
    })
  })
})
