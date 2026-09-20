const { formatMessagesForContext } = require('../util/chat/contextHelper')

describe('Time Weighting in Context Helper', () => {
  let originalDateNow

  beforeAll(() => {
    originalDateNow = Date.now
    // Mock current time to a fixed timestamp for predictable relative time tests
    Date.now = jest.fn(() => new Date('2026-05-03T12:00:00Z').getTime())
  })

  afterAll(() => {
    Date.now = originalDateNow
  })

  it('formats relative times correctly for various elapsed times', async () => {
    const now = Date.now()

    const messages = new Map([
      ['1', { id: '1', author: { id: 'bot123', username: 'Skynet' }, content: 'just now msg', createdAt: new Date(now - 1000 * 30) }], // 30 seconds ago
      ['2', { id: '2', author: { id: 'user2', username: 'bob' }, content: 'minutes ago msg', createdAt: new Date(now - 1000 * 60 * 5) }], // 5 mins ago
      ['3', { id: '3', author: { id: 'bot123', username: 'Skynet' }, content: 'hours ago msg', createdAt: new Date(now - 1000 * 60 * 60 * 3) }], // 3 hours ago
      ['4', { id: '4', author: { id: 'user2', username: 'bob' }, content: 'days ago msg', createdAt: new Date(now - 1000 * 60 * 60 * 24 * 2) }] // 2 days ago
    ])

    const formatted = await formatMessagesForContext(messages, 'bot123')

    expect(formatted).toHaveLength(4)

    // Sorted oldest to newest
    // 4 -> 3 -> 2 -> 1
    expect(formatted[0].content).toContain('[ID: 4 | 2d ago]')
    expect(formatted[0].content).toContain('days ago msg')

    expect(formatted[1].content).toContain('[ID: 3 | 3h ago]')
    expect(formatted[1].content).toContain('hours ago msg')

    expect(formatted[2].content).toContain('[ID: 2 | 5m ago]')
    expect(formatted[2].content).toContain('minutes ago msg')

    expect(formatted[3].content).toContain('[ID: 1 | just now]')
    expect(formatted[3].content).toContain('just now msg')
  })

  it('identifies bot messages properly', async () => {
    const now = Date.now()
    const messages = new Map([
      ['1', { id: '1', author: { id: 'bot123', username: 'Skynet' }, content: 'I am a bot', createdAt: new Date(now - 1000 * 60 * 10) }]
    ])

    const formatted = await formatMessagesForContext(messages, 'bot123')
    expect(formatted[0].role).toBe('assistant')
    expect(formatted[0].content).toContain('[ID: 1 | 10m ago]')
  })

  it('filters out bot status and thinking placeholders from context', async () => {
    const now = Date.now()
    const messages = new Map([
      ['1', { id: '1', author: { id: 'bot123', username: 'Skynet' }, content: '*Skynet is thinking...*', createdAt: new Date(now - 1000 * 30) }],
      ['2', { id: '2', author: { id: 'bot123', username: 'Skynet' }, content: '*Skynet is thinking...* (12s)', createdAt: new Date(now - 1000 * 25) }],
      ['3', { id: '3', author: { id: 'bot123', username: 'Skynet' }, content: '*Skynet is autonomously executing...*', createdAt: new Date(now - 1000 * 20) }],
      ['4', { id: '4', author: { id: 'user1', username: 'alice' }, content: 'hello', createdAt: new Date(now - 1000 * 15) }],
      ['5', { id: '5', author: { id: 'bot123', username: 'Skynet' }, content: '*Skynet is thinking...*\nActual answer here', createdAt: new Date(now - 1000 * 10) }]
    ])

    const formatted = await formatMessagesForContext(messages, 'bot123')
    // Messages 1, 2, 3 should be dropped completely.
    // Message 4 (user) and Message 5 (bot with actual answer scrubbed of thinking) should remain.
    expect(formatted).toHaveLength(2)
    expect(formatted[0].role).toBe('user')
    expect(formatted[0].content).toContain('hello')
    expect(formatted[1].role).toBe('assistant')
    expect(formatted[1].content).toContain('Actual answer here')
    expect(formatted[1].content).not.toContain('thinking')
  })
})
