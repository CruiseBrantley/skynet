const { queryLocalOrRemote } = require('../util/ollama')
const logger = require('../logger')

jest.mock('../util/ollama')
jest.mock('../logger')
jest.mock('../util/chat/gifService', () => ({
  getGif: jest.fn().mockResolvedValue('https://giphy.com/mock-proactive-reaction.gif')
}))
jest.mock('../util/AgentMemory', () => ({
  get: jest.fn().mockReturnValue(null), // skip gate always allows evaluation
  set: jest.fn(),
  getSummary: jest.fn().mockReturnValue(null)
}))

describe('AgentLoop - Proactive Presence', () => {
  let mockChannel
  let mockMessages
  let agentLoop
  const guildId = 'guild-1'

  beforeEach(() => {
    jest.clearAllMocks()

    const fixedDate = new Date('2026-04-20T12:00:00Z').getTime()
    jest.spyOn(Date, 'now').mockReturnValue(fixedDate)

    agentLoop = require('../util/AgentLoop')

    mockMessages = new Map()
    mockMessages.reverse = jest.fn().mockReturnValue(mockMessages)
    mockMessages.first = jest
      .fn()
      .mockImplementation(() => [...mockMessages.values()].sort((a,b) => b.createdAt - a.createdAt)[0])
    mockMessages.map = jest
      .fn()
      .mockImplementation((fn) => [...mockMessages.values()].map(fn))

    mockChannel = {
      name: 'general',
      id: 'channel-1',
      guild: {
        id: guildId,
        channels: {
          fetch: jest.fn().mockResolvedValue(new Map([
            ['channel-1', { name: 'general', id: 'channel-1', isTextBased: () => true }]
          ]))
        },
        emojis: {
          cache: new Map([
            ['emoji-1', { name: 'custom_emoji', id: '123456789' }]
          ])
        }
      },
      messages: {
        fetch: jest.fn().mockImplementation((opt) => {
          if (typeof opt === 'string') { return Promise.resolve(mockMessages.get(opt)) }
          return Promise.resolve(mockMessages)
        })
      },
      send: jest.fn().mockResolvedValue({})
    }
    agentLoop.start({ user: { id: 'bot-id' } }, 60000)
  })

  test('handles both reactions and interjections in one pass', async () => {
    mockMessages.set('msg-old-1', {
      id: 'msg-old-1',
      author: { id: 'user-old-1', username: 'u' },
      content: 'hi',
      createdAt: new Date(Date.now() - 10000)
    })
    mockMessages.set('msg-old-2', {
      id: 'msg-old-2',
      author: { id: 'user-old-2', username: 'u' },
      content: 'hello',
      createdAt: new Date(Date.now() - 5000)
    })

    const msg = {
      id: 'msg-1',
      author: { id: 'user-1', username: 'user1' },
      content: 'Check out this cool bot I built!',
      createdAt: new Date(Date.now()),
      react: jest.fn().mockResolvedValue(undefined),
      reactions: {
        cache: {
          get: jest.fn().mockReturnValue(null),
          find: jest.fn().mockReturnValue(null)
        }
      }
    }
    mockMessages.set('msg-1', msg)
    mockMessages.size = 3

    queryLocalOrRemote.mockResolvedValue({
      message: {
        content: JSON.stringify({
          reasoning: "User built a cool bot, I want to show support and react.",
          interject: {
            message: "Wow user1, that bot looks incredible. How long did it take you?",
            replyToId: null
          },
          reactions: [
            { messageId: "msg-1", emoji: "🔥" }
          ],
          commands: []
        })
      }
    })
 
    await agentLoop._evaluateProactivePresence(mockChannel, guildId)
 
    expect(msg.react).toHaveBeenCalledWith('🔥')
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('incredible') })
    )
  })

  test('handles proactive interjection with a GIF', async () => {
    const gifService = require('../util/chat/gifService')
    gifService.getGif.mockResolvedValueOnce('https://giphy.com/mock-proactive-reaction.gif')

    mockMessages.set('msg-old-1', {
      id: 'msg-old-1',
      author: { id: 'user-old-1', username: 'u' },
      content: 'hi',
      createdAt: new Date(Date.now() - 10000)
    })
    mockMessages.set('msg-old-2', {
      id: 'msg-old-2',
      author: { id: 'user-old-2', username: 'u' },
      content: 'hello',
      createdAt: new Date(Date.now() - 5000)
    })
    mockMessages.set('msg-1', {
      id: 'msg-1',
      author: { id: 'user-1', username: 'user1' },
      content: 'I got the promotion!',
      createdAt: new Date(Date.now()),
      react: jest.fn(),
      reactions: { cache: { get: jest.fn(), find: jest.fn() } }
    })
    mockMessages.size = 3

    queryLocalOrRemote.mockResolvedValue({
      message: {
        content: JSON.stringify({
          reasoning: "User got promoted, let's post a celebratory GIF.",
          interject: {
            message: "Congratulations!",
            replyToId: null,
            gif: "congratulations"
          },
          reactions: [],
          commands: []
        })
      }
    })

    await agentLoop._evaluateProactivePresence(mockChannel, guildId)

    expect(gifService.getGif).toHaveBeenCalledWith('congratulations', guildId)
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Congratulations!',
        embeds: [expect.objectContaining({ data: expect.objectContaining({ image: { url: 'https://giphy.com/mock-proactive-reaction.gif' } }) })]
      })
    )
  })

  test('does nothing on NOOP', async () => {
    mockMessages.set('msg-old-1', { id: 'msg-old-1', author: { id: 'u1' }, content: 'hi', createdAt: new Date(Date.now() - 10000) })
    mockMessages.set('msg-old-2', { id: 'msg-old-2', author: { id: 'u2' }, content: 'hello', createdAt: new Date(Date.now() - 5000) })
 
    const msg = {
      id: 'msg-1',
      author: { id: 'u3', username: 'user1' },
      content: 'hello',
      createdAt: new Date(Date.now()),
      react: jest.fn(),
      reactions: { cache: { find: jest.fn() } }
    }
    mockMessages.set('msg-1', msg)
    mockMessages.size = 3
 
    queryLocalOrRemote.mockResolvedValue({
      message: {
        content: JSON.stringify({
          reasoning: "No action needed.",
          interject: null,
          reactions: [],
          commands: []
        })
      }
    })
 
    await agentLoop._evaluateProactivePresence(mockChannel, guildId)
 
    expect(msg.react).not.toHaveBeenCalled()
    expect(mockChannel.send).not.toHaveBeenCalled()
  })
 
  test('INTERJECT with replyToId replies to the specific message', async () => {
    const targetMsg = {
      id: 'msg-target',
      author: { id: 'u-target', username: 'user1' },
      content: 'Anyone know a good recipe for pasta?',
      createdAt: new Date(Date.now()),
      react: jest.fn().mockResolvedValue({}),
      reply: jest.fn().mockResolvedValue({}),
      reactions: { cache: { get: jest.fn().mockReturnValue(null), find: jest.fn().mockReturnValue(null) } }
    }
    mockMessages.set('msg-old-1', { id: 'msg-old-1', author: { id: 'u1' }, content: 'hi', createdAt: new Date(Date.now() - 10000) })
    mockMessages.set('msg-old-2', { id: 'msg-old-2', author: { id: 'u2' }, content: 'hello', createdAt: new Date(Date.now() - 5000) })
    mockMessages.set('msg-target', targetMsg)
    mockMessages.size = 3
 
    queryLocalOrRemote.mockResolvedValue({
      message: {
        content: JSON.stringify({
          reasoning: "User wants a recipe, recommending carbonara.",
          interject: {
            message: "Try carbonara! Eggs, pancetta, pecorino.",
            replyToId: "msg-target"
          },
          reactions: [],
          commands: []
        })
      }
    })
 
    await agentLoop._evaluateProactivePresence(mockChannel, guildId)
 
    expect(targetMsg.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('carbonara') }))
    expect(mockChannel.send).not.toHaveBeenCalled()
  })
 
  test('INTERJECT with replyToId falls back to channel.send when message not found', async () => {
    mockMessages.set('msg-old-1', { id: 'msg-old-1', author: { id: 'u1' }, content: 'hi', createdAt: new Date(Date.now() - 10000) })
    mockMessages.set('msg-old-2', { id: 'msg-old-2', author: { id: 'u2' }, content: 'hello', createdAt: new Date(Date.now() - 5000) })
    mockMessages.set('msg-new', { id: 'msg-new', author: { id: 'u3' }, content: 'latest', createdAt: new Date(Date.now()), react: jest.fn(), reactions: { cache: { get: jest.fn(), find: jest.fn() } } })
    mockMessages.size = 3
 
    // fetch for a specific messageId returns null (message was deleted)
    mockChannel.messages.fetch.mockImplementation((opt) => {
      if (typeof opt === 'string' && opt === 'msg-deleted') return Promise.resolve(null)
      return Promise.resolve(mockMessages)
    })
 
    queryLocalOrRemote.mockResolvedValue({
      message: {
        content: JSON.stringify({
          reasoning: "Replying to user message.",
          interject: {
            message: "Interesting point!",
            replyToId: "msg-deleted"
          },
          reactions: [],
          commands: []
        })
      }
    })
 
    await agentLoop._evaluateProactivePresence(mockChannel, guildId)
 
    expect(mockChannel.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Interesting point!') }))
  })
 
  test('standard interjection without replyToId posts to the channel', async () => {
    mockMessages.set('msg-old-1', { id: 'msg-old-1', author: { id: 'u1' }, content: 'hi', createdAt: new Date(Date.now() - 10000) })
    mockMessages.set('msg-old-2', { id: 'msg-old-2', author: { id: 'u2' }, content: 'hello', createdAt: new Date(Date.now() - 5000) })
    mockMessages.set('msg-1', { id: 'msg-1', author: { id: 'u3' }, content: 'latest', createdAt: new Date(Date.now()), react: jest.fn(), reactions: { cache: { get: jest.fn(), find: jest.fn() } } })
    mockMessages.size = 3
 
    queryLocalOrRemote.mockResolvedValue({
      message: {
        content: JSON.stringify({
          reasoning: "Interjecting to channel",
          interject: {
            message: "Hey this is a standard message",
            replyToId: null
          },
          reactions: [],
          commands: []
        })
      }
    })
 
    await agentLoop._evaluateProactivePresence(mockChannel, guildId)
 
    expect(mockChannel.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('standard message') }))
  })
 
  test('injects memory rules and memory compliance instructions into the prompt', async () => {
    mockMessages.set('msg-old-1', { id: 'msg-old-1', author: { id: 'u1' }, content: 'hi', createdAt: new Date(Date.now() - 10000) })
    mockMessages.set('msg-old-2', { id: 'msg-old-2', author: { id: 'u2' }, content: 'hello', createdAt: new Date(Date.now() - 5000) })
    mockMessages.set('msg-1', { id: 'msg-1', author: { id: 'u3' }, content: 'latest', createdAt: new Date(Date.now()), react: jest.fn(), reactions: { cache: { get: jest.fn(), find: jest.fn() } } })
    mockMessages.size = 3
 
    const agentMemory = require('../util/AgentMemory')
    agentMemory.getSummary.mockReturnValue('- behavior.test_rule: active')
 
    queryLocalOrRemote.mockResolvedValue({
      message: {
        content: JSON.stringify({
          reasoning: "No action needed.",
          interject: null,
          reactions: [],
          commands: []
        })
      }
    })
 
    await agentLoop._evaluateProactivePresence(mockChannel, guildId)
 
    const callArgs = queryLocalOrRemote.mock.calls[0][1]
    const systemPrompt = callArgs.messages[0].content
 
    expect(systemPrompt).toContain('[LONG-TERM MEMORY & ACTIVE RULES]')
    expect(systemPrompt).toContain('- behavior.test_rule: active')
    expect(systemPrompt).toContain('MEMORY COMPLIANCE')
    
    // Reset mock for other tests if necessary
    agentMemory.getSummary.mockReturnValue(null)
  })

  test('injects active channels and custom emojis into the system prompt', async () => {
    mockMessages.set('msg-old-1', { id: 'msg-old-1', author: { id: 'u1' }, content: 'hi', createdAt: new Date(Date.now() - 10000) })
    mockMessages.set('msg-old-2', { id: 'msg-old-2', author: { id: 'u2' }, content: 'hello', createdAt: new Date(Date.now() - 5000) })
    mockMessages.set('msg-1', { id: 'msg-1', author: { id: 'u3' }, content: 'latest', createdAt: new Date(Date.now()), react: jest.fn(), reactions: { cache: { get: jest.fn(), find: jest.fn() } } })
    mockMessages.size = 3

    queryLocalOrRemote.mockResolvedValue({
      message: {
        content: JSON.stringify({
          reasoning: "No action needed.",
          interject: null,
          reactions: [],
          commands: []
        })
      }
    })

    await agentLoop._evaluateProactivePresence(mockChannel, guildId)

    const callArgs = queryLocalOrRemote.mock.calls[0][1]
    const systemPrompt = callArgs.messages[0].content

    expect(systemPrompt).toContain('[AVAILABLE GUILD RESOURCES]')
    expect(systemPrompt).toContain('Text Channels on this server:')
    expect(systemPrompt).toContain('#general (ID: "channel-1")')
    expect(systemPrompt).toContain('Custom Emojis on this server:')
    expect(systemPrompt).toContain(':custom_emoji: -> <:custom_emoji:123456789>')
  })
})
