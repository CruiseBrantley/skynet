const agentLoop = require('../util/AgentLoop')
const logger = require('../logger')

describe('AgentLoop Self-Talk Prevention', () => {
  let mockBot
  let mockChannel

  beforeEach(() => {
    jest.clearAllMocks()
    mockBot = {
      user: { id: 'bot123' }
    }
    mockChannel = {
      name: 'general',
      id: 'chan123',
      messages: {
        fetch: jest.fn()
      }
    }
    agentLoop.start(mockBot, 60000)
  })

  test('skips evaluation if the last message was from the bot', async () => {
    const messages = new Map([
      ['msg1', { id: 'msg1', author: { id: 'bot123' }, createdAt: new Date() }],
      ['msg2', { id: 'msg2', author: { id: 'human456' }, createdAt: new Date(Date.now() - 1000) }],
      ['msg3', { id: 'msg3', author: { id: 'human789' }, createdAt: new Date(Date.now() - 2000) }]
    ])
    messages.first = () => messages.get('msg1')
    messages.size = 3
    mockChannel.messages.fetch.mockResolvedValue(messages)

    const loggerInfoSpy = jest.spyOn(logger, 'info')
    
    await agentLoop._evaluateProactivePresence(mockChannel, 'guild123')

    expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining('skipping #general — last message was from me'))
  })

  test('proceeds with evaluation if the last message was from a human', async () => {
    const messages = new Map([
      ['msg1', { id: 'msg1', author: { id: 'human456' }, createdAt: new Date() }],
      ['msg2', { id: 'msg2', author: { id: 'human789' }, createdAt: new Date(Date.now() - 1000) }],
      ['msg3', { id: 'msg3', author: { id: 'human012' }, createdAt: new Date(Date.now() - 2000) }]
    ])
    messages.first = () => messages.get('msg1')
    messages.size = 3
    mockChannel.messages.fetch.mockResolvedValue(messages)

    // We expect it to proceed past the author check and eventually fail at Ollama or similar
    // because we haven't mocked the context helper or ollama query.
    // But the absence of the "skipping ... last message was from me" log is what we're testing.
    const loggerInfoSpy = jest.spyOn(logger, 'info')
    
    try {
      await agentLoop._evaluateProactivePresence(mockChannel, 'guild123')
    } catch (e) {
      // Expected failure later in the function
    }

    expect(loggerInfoSpy).not.toHaveBeenCalledWith(expect.stringContaining('skipping #general — last message was from me'))
  })
})
