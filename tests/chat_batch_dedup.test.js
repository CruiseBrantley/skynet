const mockExecuteAction = jest.fn().mockResolvedValue({ success: true, output: 'Success' })
const mockListActions = jest.fn().mockReturnValue([
  { name: 'create_poll', description: 'Create a poll', schema: {} },
  { name: 'send_embed', description: 'Send an embed', schema: {} },
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

jest.mock('../util/AgentMemory', () => ({
  getSummary: jest.fn().mockReturnValue(null),
  set: jest.fn(),
  get: jest.fn()
}))

describe('Chat Batch & De-duplication Safety', () => {
  let mockInteraction

  beforeEach(() => {
    queryOllamaWithContext.mockReset()
    mockListActions.mockReset()
    mockExecuteAction.mockClear()

    // Default actions
    mockListActions.mockReturnValue([
      { name: 'create_poll', description: 'Create a poll', schema: {} },
      { name: 'send_embed', description: 'Send an embed', schema: {} },
      { name: 'add_reaction', description: 'Add reaction', schema: {} }
    ])

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
        getString: jest.fn().mockReturnValue('create a poll and an embed'),
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

  test('Batch Execution: Should run a mix of utility and high-impact commands in one turn', async () => {
    // AI outputs BOTH commands in the first response
    queryOllamaWithContext.mockResolvedValueOnce({
      message: {
        content: 'I will do both! \n <<<RUN_COMMAND: {"command": "add_reaction", "emoji": "👍"}>>> \n <<<RUN_COMMAND: {"command": "send_embed", "title": "Pasta"}>>>'
      }
    })

    // Final followup after BOTH are done
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { content: 'All done!' }
    })

    await chat.execute(mockInteraction, {})

    // Verification 1: Both ran
    expect(mockExecuteAction).toHaveBeenCalledWith('add_reaction', expect.anything(), expect.anything())
    expect(mockExecuteAction).toHaveBeenCalledWith('send_embed', expect.anything(), expect.anything())

    // Verification 2: ONLY TWO queries to Ollama total (Initial + ONE followup)
    // If Batch Drain works, we don't query after poll, we just move to embed.
    expect(queryOllamaWithContext).toHaveBeenCalledTimes(2)
  })

  test('De-duplication: Should reject a command if it is repeated in a followup with the exact same JSON', async () => {
    // AI outputs one command
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { content: 'Doing the poll. <<<RUN_COMMAND: {"command": "create_poll", "question": "Pizza?"}>>>' }
    })

    // Followup REPEATS the same tag (common AI hallucination/repetition)
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { content: 'I already did the poll: <<<RUN_COMMAND: {"command": "create_poll", "question": "Pizza?"}>>>' }
    })

    // Final followup
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { content: 'Truly done now.' }
    })

    await chat.execute(mockInteraction, {})

    // Verification: create_poll ran exactly ONCE
    expect(mockExecuteAction).toHaveBeenCalledTimes(1)
  })

  test('Chain Consistency: Should allow DIFFERENT versions of the same command name', async () => {
    // e.g. adding two different reactions
    mockListActions.mockReturnValue([{ name: 'add_reaction', description: 'Add reaction', schema: {} }])

    queryOllamaWithContext.mockResolvedValueOnce({
      message: { content: 'Adding reactions! <<<RUN_COMMAND: {"command": "add_reaction", "emoji": "👍"}>>>' }
    }).mockResolvedValueOnce({
      message: { content: 'And another! <<<RUN_COMMAND: {"command": "add_reaction", "emoji": "🔥"}>>>' }
    }).mockResolvedValueOnce({
      message: { content: 'Done.' }
    })

    await chat.execute(mockInteraction, {})

    // Verification: add_reaction ran TWICE (because JSON/params were different)
    expect(mockExecuteAction).toHaveBeenCalledTimes(2)
    expect(mockExecuteAction).toHaveBeenCalledWith('add_reaction', expect.objectContaining({ emoji: '👍' }), expect.anything())
    expect(mockExecuteAction).toHaveBeenCalledWith('add_reaction', expect.objectContaining({ emoji: '🔥' }), expect.anything())
  })

  test('Strict JSON De-duplication: Should block whitelisted actions if the FULL JSON is identical', async () => {
    // AI outputs EXACT SAME add_reaction twice
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { content: 'Double reaction! <<<RUN_COMMAND: {"command": "add_reaction", "emoji": "👍"}>>> <<<RUN_COMMAND: {"command": "add_reaction", "emoji": "👍"}>>>' }
    }).mockResolvedValueOnce({
      message: { content: 'Done.' }
    })

    await chat.execute(mockInteraction, {})

    // Verification: add_reaction ran only ONCE because the second one was exact same JSON
    expect(mockExecuteAction).toHaveBeenCalledTimes(1)
  })

  test('Hallucination Protection: Should block redundant execution of high-impact commands (e.g. multiple embeds)', async () => {
    // AI outputs TWO embeds in one message WITH NO OTHER TEXT
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { content: '<<<RUN_COMMAND: {"command": "send_embed", "title": "First"}>>> <<<RUN_COMMAND: {"command": "send_embed", "title": "Second"}>>>' }
    }).mockResolvedValueOnce({
      message: { content: '' }
    })

    await chat.execute(mockInteraction, {})

    // Verification: send_embed ran exactly ONCE despite two tags
    expect(mockExecuteAction).toHaveBeenCalledTimes(1)
    expect(mockExecuteAction).toHaveBeenCalledWith('send_embed', expect.objectContaining({ title: 'First' }), expect.anything())

    // Verification: interaction was DELETED because no text was left
    expect(mockInteraction.deleteReply).toHaveBeenCalled()
  })
})
