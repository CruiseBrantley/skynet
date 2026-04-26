const { queryLocalOrRemote } = require('../util/ollama')
const logger = require('../logger')

jest.mock('../util/ollama')
jest.mock('../logger')
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
      .mockImplementation(() => [...mockMessages.values()][0])
    mockMessages.map = jest
      .fn()
      .mockImplementation((fn) => [...mockMessages.values()].map(fn))

    mockChannel = {
      name: 'general',
      id: 'channel-1',
      messages: {
        fetch: jest.fn().mockImplementation((opt) => {
          if (typeof opt === 'string') { return Promise.resolve(mockMessages.get(opt)) }
          return Promise.resolve(mockMessages)
        })
      },
      send: jest.fn().mockResolvedValue({})
    }
  })

  test('handles both reactions and interjections in one pass', async () => {
    mockMessages.set('msg-old-1', {
      id: 'msg-old-1',
      author: { username: 'u' },
      content: 'hi',
      createdAt: new Date(Date.now())
    })
    mockMessages.set('msg-old-2', {
      id: 'msg-old-2',
      author: { username: 'u' },
      content: 'hello',
      createdAt: new Date(Date.now())
    })

    const msg = {
      id: 'msg-1',
      author: { username: 'user1' },
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

    queryLocalOrRemote.mockResolvedValue({
      message: {
        content: `That's awesome!
                <<<REACT: {"messageId": "msg-1", "emoji": "🔥", "reason": "Cool bot"}>>>
                <<<INTERJECT: "Wow user1, that bot looks incredible. How long did it take you?">>>`
      }
    })

    await agentLoop._evaluateProactivePresence(mockChannel, guildId)

    expect(msg.react).toHaveBeenCalledWith('🔥')
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.stringContaining('incredible')
    )
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Interjected')
    )
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Proactively reacted')
    )
  })

  test('does nothing on NOOP', async () => {
    mockMessages.set('msg-old-1', {
      id: 'msg-old-1',
      author: { username: 'u' },
      content: 'hi',
      createdAt: new Date(Date.now())
    })
    mockMessages.set('msg-old-2', {
      id: 'msg-old-2',
      author: { username: 'u' },
      content: 'hello',
      createdAt: new Date(Date.now())
    })

    const msg = {
      id: 'msg-1',
      author: { username: 'user1' },
      content: 'hello',
      createdAt: new Date(Date.now()),
      react: jest.fn(),
      reactions: { cache: { find: jest.fn() } }
    }
    mockMessages.set('msg-1', msg)

    queryLocalOrRemote.mockResolvedValue({
      message: { content: 'NOOP' }
    })

    await agentLoop._evaluateProactivePresence(mockChannel, guildId)

    expect(msg.react).not.toHaveBeenCalled()
    expect(mockChannel.send).not.toHaveBeenCalled()
  })

  test('skips stale conversations', async () => {
    const oldDate = new Date(Date.now() - 30 * 60 * 1000)
    const msg = {
      id: 'msg-1',
      author: { username: 'user1' },
      content: 'old news',
      createdAt: oldDate,
      react: jest.fn()
    }
    mockMessages.set('msg-1', msg)

    await agentLoop._evaluateProactivePresence(mockChannel, guildId)

    expect(queryLocalOrRemote).not.toHaveBeenCalled()
  })
})
