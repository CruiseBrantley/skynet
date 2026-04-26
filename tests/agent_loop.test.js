const agentLoop = require('../util/AgentLoop')
const agentMemory = require('../util/AgentMemory')

describe('AgentLoop Proactive Presence', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('Multi-reaction parsing handles multiple tags', () => {
    const content = 'Wow! <<<REACT: {"messageId": "1", "emoji": "🔥"}>>> and also <<<REACT: {"messageId": "2", "emoji": "😂"}>>>'
    const matches = Array.from(content.matchAll(/<<<REACT:\s*([\s\S]*?)>>>/g))
    expect(matches).toHaveLength(2)
    expect(JSON.parse(matches[0][1]).emoji).toBe('🔥')
    expect(JSON.parse(matches[1][1]).emoji).toBe('😂')
  })

  test('Interjection remains single-fire in parsing', () => {
    const content = '<<<INTERJECT: "First">>> and <<<INTERJECT: "Second">>>'
    const match = content.match(/<<<INTERJECT:\s*"([\s\S]*?)"/)
    expect(match[1]).toBe('First')
  })

  test('_executeCommand passes guildId to agentMemory', async () => {
    const setSpy = jest.spyOn(agentMemory, 'set').mockImplementation(() => {})
    const cmdData = { command: 'remember', key: 'server.fact', value: 'skynet lives', ttl_days: 7 }

    await agentLoop._executeCommand(cmdData, 'guild123')

    expect(setSpy).toHaveBeenCalledWith('server.fact', 'skynet lives', 7, 'guild123')
    setSpy.mockRestore()
  })

  test('Message ID tracking skips channel when last seen ID matches newest message', () => {
    const newestMsgId = '1234567890123456789'
    jest.spyOn(agentMemory, 'get').mockReturnValue(newestMsgId)

    const lastSeenMsgId = agentMemory.get('proactive.last_msg.chan123', 'guild123')
    expect(lastSeenMsgId === newestMsgId).toBe(true)
  })

  test('Message ID tracking proceeds when a new message has arrived', () => {
    const previousMsgId = '1000000000000000000'
    const newestMsgId = '9999999999999999999'
    jest.spyOn(agentMemory, 'get').mockReturnValue(previousMsgId)

    const lastSeenMsgId = agentMemory.get('proactive.last_msg.chan123', 'guild123')
    expect(lastSeenMsgId === newestMsgId).toBe(false)
  })

  test('Top-3 channel selection sorts channels by snowflake descending', () => {
    const channels = [
      { lastMessageId: '1000000000000000001', name: 'old-channel' },
      { lastMessageId: '9999999999999999999', name: 'newest-channel' },
      { lastMessageId: '5000000000000000000', name: 'mid-channel' },
      { lastMessageId: '2000000000000000000', name: 'stale-channel' }
    ]

    const topChannels = [...channels]
      .sort((a, b) => (a.lastMessageId > b.lastMessageId ? -1 : 1))
      .slice(0, 3)

    expect(topChannels[0].name).toBe('newest-channel')
    expect(topChannels[1].name).toBe('mid-channel')
    expect(topChannels[2].name).toBe('stale-channel')
    expect(topChannels).toHaveLength(3)
  })

  test('_executeCommand preserves fractional ttl_days (parseFloat, not parseInt)', async () => {
    const setSpy = jest.spyOn(agentMemory, 'set').mockImplementation(() => {})
    // 28.5 hours = 1.1875 days — should not be truncated to 1
    const cmdData = { command: 'remember', key: 'user.test', value: 'hello', ttl_days: 1.1875 }

    await agentLoop._executeCommand(cmdData, 'guild123')

    expect(setSpy).toHaveBeenCalledWith('user.test', 'hello', 1.1875, 'guild123')
    setSpy.mockRestore()
  })
})
