const mockExecuteAction = jest.fn().mockResolvedValue({ success: true, output: 'Success' })
const mockListActions = jest.fn().mockReturnValue([
  { name: 'send_embed', description: 'Send embed', schema: {} },
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
const botName = 'Skynet'
const database = {}

describe('Chat Command - Multi-Turn Hallucination Gauntlet', () => {
  let mockInteraction

  beforeEach(() => {
    jest.clearAllMocks()
    mockListActions.mockReturnValue([
      { name: 'send_embed', description: 'Send embed', schema: {} },
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
          get: jest.fn().mockImplementation((name) => {
            if (name === 'send_embed') return { execute: jest.fn() }
            return null
          }),
          map: jest.fn().mockReturnValue([])
        },
        users: { cache: { get: jest.fn() } }
      },
      options: {
        getString: jest.fn().mockReturnValue('make an embed about ghosts'),
        getAttachment: jest.fn().mockReturnValue(null),
        get: jest.fn().mockReturnValue(null)
      },
      channel: {
        id: '456',
        name: 'test-channel',
        messages: { fetch: jest.fn().mockResolvedValue({ map: () => [], reverse: () => ({ join: () => '' }), size: 0 }) }
      },
      deferReply: jest.fn().mockResolvedValue({}),
      editReply: jest.fn().mockResolvedValue({}),
      followUp: jest.fn().mockResolvedValue({}),
      deleteReply: jest.fn().mockResolvedValue({})
    }
  })

  test('STRIKE THREE: Should block persistent hallucinations across 3 followup turns', async () => {
    // T1: Send Embed
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { role: 'assistant', content: 'Sure: <<<RUN_COMMAND: {"command": "send_embed", "title": "Poltergeist"}>>>' }
    })
    // T2: Hallucination - AI tries to send same embed again
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'I should also make sure you saw this: <<<RUN_COMMAND: {"command": "send_embed", "title": "Ghost"}>>>' }
      })
    // T3: Hallucination - AI tries again
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Still thinking... <<<RUN_COMMAND: {"command": "send_embed", "title": "Apparition"}>>>' }
      })
    // T4: Cleanup
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Done!' }
      })

    const ActionExecutor = require('../util/ActionExecutor')
    await chat.execute(mockInteraction, database)

    // Verification: Even across multiple followup LLM turns, the command was only executed ONCE.
    expect(ActionExecutor.executeAction).toHaveBeenCalledTimes(1)
    expect(ActionExecutor.executeAction).toHaveBeenCalledWith('send_embed', expect.objectContaining({ title: 'Poltergeist' }), expect.anything())
  })

  test('CASE-INSENSITIVE: Should block "SEND_EMBED" if "send_embed" was already fired', async () => {
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { role: 'assistant', content: 'Here: <<<RUN_COMMAND: {"command": "send_embed", "title": "1"}>>>' }
    }).mockResolvedValueOnce({
      message: { role: 'assistant', content: 'Again: <<<RUN_COMMAND: {"command": "SEND_EMBED", "title": "2"}>>>' }
    }).mockResolvedValueOnce({
      message: { role: 'assistant', content: 'Done.' }
    })

    const ActionExecutor = require('../util/ActionExecutor')
    await chat.execute(mockInteraction, database)

    expect(ActionExecutor.executeAction).toHaveBeenCalledTimes(1)
  })
})
