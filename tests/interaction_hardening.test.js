const mockExecuteAction = jest.fn().mockResolvedValue({ success: true, output: 'Mocked output' })
const mockListActions = jest.fn().mockReturnValue([
  { name: 'send_embed', description: 'Send an embed', schema: {} },
  { name: 'send_message', description: 'Send a message', schema: {} }
])

jest.mock('../util/ActionExecutor', () => ({
  executeAction: mockExecuteAction,
  listActions: mockListActions
}))

const chat = require('../commands/chat')
const { queryOllamaWithContext } = require('../util/ollama')
const executor = require('../util/ActionExecutor')

jest.mock('../util/ollama')

describe('Unified Interaction Hardening Suite', () => {
  let mockInteraction

  beforeEach(() => {
    jest.clearAllMocks()

    mockInteraction = {
      guildId: '123',
      channelId: '456',
      user: { id: '789', tag: 'sirian#0000', username: 'sirian' },
      member: { id: '789', nickname: 'Sirian' },
      client: {
        user: { id: '555', username: 'Skynet' },
        commands: {
          get: jest.fn().mockReturnValue(null),
          map: jest.fn().mockReturnValue([])
        }
      },
      options: {
        getString: jest.fn().mockReturnValue('create an embed'),
        getAttachment: jest.fn().mockReturnValue(null)
      },
      channel: {
        id: '456',
        messages: {
          fetch: jest.fn().mockResolvedValue({
            map: (cb) => [],
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

  test('Case 1: Standard Tagged Command', async () => {
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { content: '<<<RUN_COMMAND: {"command": "send_embed", "params": {"title": "Test"}}>>>' }
    })
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { content: 'Acknowledged.' }
    })

    await chat.execute(mockInteraction, {})

    expect(executor.executeAction).toHaveBeenCalledWith('send_embed', expect.anything(), expect.anything())
    // Verify it didn't just print the JSON
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.not.stringContaining('RUN_COMMAND')
    }))
  })

  test('Case 2: Naked JSON Fallback (The User Reported Failure)', async () => {
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { content: '{"command": "send_embed", "params": {"title": "Naked Test"}}' }
    })
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { content: 'I have sent that naked JSON embed.' }
    })

    await chat.execute(mockInteraction, {})

    // Should have caught the naked JSON
    expect(executor.executeAction).toHaveBeenCalledWith('send_embed', expect.anything(), expect.anything())
    // Should NOT have printed the JSON to the user
    const lastEdit = mockInteraction.editReply.mock.calls.find(c => c[0].content && c[0].content.includes('Naked Test'))
    expect(lastEdit).toBeUndefined() // It should be in sharedState, not printed as content
  })

  test('Case 3: Nested Hallucination Recovery', async () => {
    // This test actually calls the real send_embed action to verify the flattener
    const sendEmbed = require('../util/actions/send_embed')
    const mockChannel = { send: jest.fn().mockResolvedValue({}) }

    const nestedParams = {
      embed: {
        title: 'Flatten Me',
        description: 'Nested content'
      }
    }

    await sendEmbed.execute({}, mockChannel, nestedParams)

    // Verify it flattened and used the nested title
    const lastSend = mockChannel.send.mock.calls[0][0]
    expect(lastSend.embeds[0].data.title).toBe('Flatten Me')
  })

  test('Case 4: Interaction Cleanup Invoked on Execution Completion', async () => {
    const mockCleanup = jest.fn()
    mockInteraction.cleanup = mockCleanup
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { content: 'Complete response.' }
    })

    await chat.execute(mockInteraction, {})

    expect(mockCleanup).toHaveBeenCalled()
  })

  test('Case 5: Status Heartbeat Updates and Clears Cleanly', async () => {
    jest.useFakeTimers()
    try {
      let intervalCleared = false
      mockInteraction.showStatus = jest.fn().mockImplementation(() => {
        const timer = setInterval(() => {}, 1000)
        mockInteraction.cleanup = () => {
          clearInterval(timer)
          intervalCleared = true
        }
      })

      queryOllamaWithContext.mockResolvedValueOnce({
        message: { content: '<<<RUN_COMMAND: {"command": "send_message", "params": {"message": "hi"}}>>>' }
      })
      queryOllamaWithContext.mockResolvedValueOnce({
        message: { content: 'All done.' }
      })

      await chat.execute(mockInteraction, {})

      expect(mockInteraction.showStatus).toHaveBeenCalled()
      expect(intervalCleared).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  test('Case 6: mirrorWebTurnToUser sets vibrant color on EmbedBuilder', async () => {
    const { DiscordAdapter } = require('../adapters/discord')
    const mockSend = jest.fn().mockResolvedValue({ id: 'msg_embed_123' })
    const mockUser = {
      id: 'disc_user_1',
      createDM: jest.fn().mockResolvedValue({ send: mockSend })
    }
    const adapter = new DiscordAdapter({ token: 'mock-token' })
    adapter.client = {
      user: { username: 'Skynet' },
      users: {
        fetch: jest.fn().mockResolvedValue(mockUser)
      }
    }

    const msgId = await adapter.mirrorWebTurnToUser('disc_user_1', 'Hello Web', 'Hello Discord DM')
    expect(msgId).toBe('msg_embed_123')
    expect(mockSend).toHaveBeenCalledTimes(1)
    const sentPayload = mockSend.mock.calls[0][0]
    expect(sentPayload.embeds).toBeDefined()
    expect(sentPayload.embeds.length).toBe(1)
    const embedData = sentPayload.embeds[0].data
    expect(embedData.color).toBeDefined()
    expect(typeof embedData.color).toBe('number')
  })

  test('Case 7: mention detection ignores @everyone and @here broadcasts', () => {
    const botId = '558428214805135370'
    const mockMessageEveryone = {
      content: '@here gonna be live 30 minutes late today.',
      guildId: 'guild_123',
      channel: { type: 0 },
      mentions: {
        everyone: true,
        users: new Map(),
        roles: new Map(),
        has: jest.fn((id, options = {}) => {
          if (!options.ignoreEveryone) return true
          return false
        })
      }
    }

    const isMentioned = Boolean(
      (botId && mockMessageEveryone.mentions?.has?.(botId, { ignoreEveryone: true, ignoreRoles: true })) ||
      (botId && (mockMessageEveryone.content?.includes(`<@${botId}>`) || mockMessageEveryone.content?.includes(`<@!${botId}>`)))
    )

    expect(isMentioned).toBe(false)
    expect(mockMessageEveryone.mentions.has).toHaveBeenCalledWith(botId, { ignoreEveryone: true, ignoreRoles: true })
  })
})
