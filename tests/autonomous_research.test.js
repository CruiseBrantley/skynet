const mockExecuteAction = jest.fn().mockResolvedValue({ success: true, output: 'Success' })
const mockListActions = jest.fn().mockReturnValue([
  { name: 'web_search', description: 'Search the web', schema: {} },
  { name: 'add_reaction', description: 'Add reaction', schema: {} }
])

jest.mock('../util/ActionExecutor', () => ({
  executeAction: mockExecuteAction,
  listActions: mockListActions
}))

jest.mock('../util/ollama', () => ({
  queryOllamaWithContext: jest.fn(),
  queryLocalOrRemote: jest.fn()
}))

const { queryOllamaWithContext } = require('../util/ollama')
const chat = require('../commands/chat')

describe('Autonomous Research & Loop Limits', () => {
  let mockInteraction

  beforeEach(() => {
    queryOllamaWithContext.mockReset()
    mockExecuteAction.mockClear()
    
    mockInteraction = {
      guildId: '123',
      channelId: '456',
      user: { id: '789', tag: 'sirian#0000', username: 'sirian' },
      member: { id: '789', nickname: 'sirian' },
      client: {
        user: { id: '555' },
        commands: { 
          get: jest.fn().mockReturnValue(null),
          map: jest.fn().mockReturnValue([])
        },
        users: { cache: { get: jest.fn() } }
      },
      options: {
        getString: jest.fn().mockReturnValue('research something deep'),
        getAttachment: jest.fn().mockReturnValue(null),
        get: jest.fn().mockReturnValue(null)
      },
      channel: {
        id: '456',
        name: 'test-channel',
        messages: { 
          fetch: jest.fn().mockResolvedValue({ 
            map: () => [],
            reverse: () => ({ join: () => '' }),
            size: 0
          })
        }
      },
      deferReply: jest.fn().mockResolvedValue({}),
      editReply: jest.fn().mockResolvedValue({}),
      followUp: jest.fn().mockResolvedValue({}),
      deleteReply: jest.fn().mockResolvedValue({})
    }
  })

  test('Research Whitelist: Should allow multiple web_search calls in one turn', async () => {
    queryOllamaWithContext
      .mockResolvedValueOnce({ message: { content: 'Searching... <<<RUN_COMMAND: {"command": "web_search", "query": "part 1"}>>>' } })
      .mockResolvedValueOnce({ message: { content: 'More depth... <<<RUN_COMMAND: {"command": "web_search", "query": "part 2"}>>>' } })
      .mockResolvedValueOnce({ message: { content: 'Final answer.' } })

    await chat.execute(mockInteraction, {})

    // Verification: web_search ran TWICE
    expect(mockExecuteAction).toHaveBeenCalledTimes(2)
    expect(mockExecuteAction).toHaveBeenCalledWith('web_search', expect.objectContaining({ query: 'part 1' }), expect.anything())
    expect(mockExecuteAction).toHaveBeenCalledWith('web_search', expect.objectContaining({ query: 'part 2' }), expect.anything())
  })

  test('Extended Budget: Should allow up to 9 command cycles (e.g. 9 reactions)', async () => {
    // We'll simulate 9 reactions. The 10th should be blocked by loopCount < 10.
    let setup = queryOllamaWithContext
    for (let i = 1; i <= 9; i++) {
      setup = setup.mockResolvedValueOnce({ message: { content: `<<<RUN_COMMAND: {"command": "add_reaction", "emoji": "${i}"}>>>` } })
    }
    setup.mockResolvedValueOnce({ message: { content: 'Done.' } })

    await chat.execute(mockInteraction, {})

    // Verification: It should have hit at least 9 executions. 
    // (Actual loop limit is 10, but each query is one cycle)
    expect(mockExecuteAction).toHaveBeenCalledTimes(9)
  })

  test('Loop Protection: Should still block identical JSON even for whitelisted commands', async () => {
    queryOllamaWithContext
      .mockResolvedValueOnce({ message: { content: '<<<RUN_COMMAND: {"command": "web_search", "query": "same"}>>> <<<RUN_COMMAND: {"command": "web_search", "query": "same"}>>>' } })
      .mockResolvedValueOnce({ message: { content: 'Done.' } })

    await chat.execute(mockInteraction, {})

    // Verification: Ran only ONCE because JSON was identical
    expect(mockExecuteAction).toHaveBeenCalledTimes(1)
  })
})
