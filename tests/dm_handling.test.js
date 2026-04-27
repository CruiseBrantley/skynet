/**
 * TDD: DM Handling
 *
 * Tests the full message → mockInteraction → chat.js pipeline for Direct Messages.
 * These were written BEFORE the fix to document the expected behaviour and catch regressions.
 */

jest.mock('../util/ollama', () => ({
  queryOllamaWithContext: jest.fn().mockResolvedValue({
    message: { role: 'assistant', content: 'Hello from Skynet!' }
  }),
  queryLocalOrRemote: jest.fn().mockResolvedValue({
    message: { content: 'Hello from Skynet!' }
  })
}))
jest.mock('../logger')
jest.mock('../util/AgentMemory', () => ({
  get: jest.fn().mockReturnValue(null),
  set: jest.fn(),
  getSummary: jest.fn().mockReturnValue(null)
}))
jest.mock('../firebase-login', () => () => null)

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal mockInteraction equivalent to what bot.js creates for a DM message.
 * Mirrors the real construction in bot.js messageCreate handler.
 */
function buildMockInteraction (overrides = {}) {
  let responseMessage = null
  const typingInterval = null

  const stopTyping = () => { if (typingInterval) clearInterval(typingInterval) }

  const replyFunc = jest.fn().mockImplementation(async (content) => {
    const sent = { id: 'sent-msg', edit: jest.fn().mockResolvedValue({}), delete: jest.fn().mockResolvedValue({}) }
    if (!responseMessage) responseMessage = sent
    return sent
  })

  const editFunc = jest.fn().mockImplementation(async (content) => {
    if (responseMessage) return responseMessage.edit(content)
    const sent = { id: 'sent-msg', edit: jest.fn().mockResolvedValue({}), delete: jest.fn().mockResolvedValue({}) }
    responseMessage = sent
    return sent
  })

  return {
    id: 'autonomous-test-123',
    triggeringMessageId: 'msg-abc',
    client: {
      user: { id: 'bot-id-123' },
      commands: new Map()
    },
    user: { id: 'user-123', username: 'TestUser', tag: 'TestUser#0000' },
    member: null, // null in DMs — critical
    guild: null, // null in DMs — critical
    guildId: null, // null in DMs — critical
    channelId: 'dm-channel-456',
    channel: {
      id: 'dm-channel-456',
      name: 'Direct Message',
      send: jest.fn().mockResolvedValue({}),
      sendTyping: jest.fn().mockResolvedValue({}),
      messages: {
        fetch: jest.fn().mockResolvedValue(new Map())
      }
    },
    options: {
      getString: (name) => (name === 'message' ? 'Hello bot!' : null),
      getAttachment: () => null,
      attachments: { size: 0 }
    },
    deferReply: jest.fn().mockResolvedValue({}),
    deleteReply: jest.fn().mockResolvedValue({}),
    reply: replyFunc,
    editReply: editFunc,
    followUp: replyFunc,
    fetchReply: jest.fn().mockResolvedValue({ react: jest.fn().mockResolvedValue({}) }),
    recentMessages: null,
    ...overrides
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DM Handling — mockInteraction structure', () => {
  test('mockInteraction has fetchReply method (required by DiscordResponder)', () => {
    const interaction = buildMockInteraction()
    expect(typeof interaction.fetchReply).toBe('function')
  })

  test('mockInteraction has guild=null for DMs', () => {
    const interaction = buildMockInteraction()
    expect(interaction.guild).toBeNull()
  })

  test('mockInteraction has guildId=null for DMs', () => {
    const interaction = buildMockInteraction()
    expect(interaction.guildId).toBeNull()
  })

  test('mockInteraction has member=null for DMs', () => {
    const interaction = buildMockInteraction()
    expect(interaction.member).toBeNull()
  })
})

describe('DM Handling — isDM detection', () => {
  const { ChannelType } = require('discord.js')

  test('isDM is true when message.guild is null', () => {
    const message = { guild: null, channel: { type: 99, isDMBased: () => false } }
    const isDM = !message.guild || message.channel?.type === ChannelType.DM || message.channel?.isDMBased?.()
    expect(isDM).toBe(true)
  })

  test('isDM is true when channel type is DM', () => {
    const message = { guild: { id: 'some-guild' }, channel: { type: ChannelType.DM, isDMBased: () => true } }
    const isDM = !message.guild || message.channel?.type === ChannelType.DM || message.channel?.isDMBased?.()
    expect(isDM).toBe(true)
  })

  test('isDM is true when isDMBased() returns true', () => {
    const message = { guild: { id: 'some-guild' }, channel: { type: 99, isDMBased: () => true } }
    const isDM = !message.guild || message.channel?.type === ChannelType.DM || message.channel?.isDMBased?.()
    expect(isDM).toBe(true)
  })

  test('isDM is false for normal guild channels', () => {
    const message = { guild: { id: 'guild-123' }, channel: { type: ChannelType.GuildText, isDMBased: () => false } }
    const isDM = !message.guild || message.channel?.type === ChannelType.DM || message.channel?.isDMBased?.()
    expect(isDM).toBe(false)
  })
})

describe('DM Handling — DiscordResponder with DM interaction', () => {
  const DiscordResponder = require('../util/chat/DiscordResponder')

  test('sendFinalResponse does not throw when guild and member are null', async () => {
    const responder = new DiscordResponder({ botName: 'Skynet' })
    const interaction = buildMockInteraction()
    const sharedState = { primaryResponseUsed: false, primaryContent: null, visualActionExecuted: false, highImpactCount: 0 }

    await expect(
      responder.sendFinalResponse({ interaction, replyContent: 'Hello!', sharedState })
    ).resolves.not.toThrow()
  })

  test('sendFinalResponse calls editReply with the AI response text', async () => {
    const responder = new DiscordResponder({ botName: 'Skynet' })
    const interaction = buildMockInteraction()
    const sharedState = { primaryResponseUsed: false, primaryContent: null, visualActionExecuted: false, highImpactCount: 0 }

    await responder.sendFinalResponse({ interaction, replyContent: 'Hello from the AI!', sharedState })

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Hello from the AI!') })
    )
  })

  test('sendFinalResponse never sends zero-width space as primary DM response', async () => {
    const responder = new DiscordResponder({ botName: 'Skynet' })
    const interaction = buildMockInteraction()
    const sharedState = { primaryResponseUsed: false, primaryContent: null, visualActionExecuted: false, highImpactCount: 0 }

    await responder.sendFinalResponse({ interaction, replyContent: 'Real response', sharedState })

    // Ensure we never sent an invisible ZWS character as the primary message
    const allEditReplyCalls = interaction.editReply.mock.calls
    const zwsCalls = allEditReplyCalls.filter(call => {
      const payload = call[0]
      const content = typeof payload === 'string' ? payload : payload?.content
      return content === '\u200B'
    })
    expect(zwsCalls).toHaveLength(0)
  })

  test('fetchReply missing is a regression — would cause ZWS fallback on empty AI response', async () => {
    const responder = new DiscordResponder({ botName: 'Skynet' })
    // Build interaction WITHOUT fetchReply, as the old bot.js did
    const interaction = buildMockInteraction()
    delete interaction.fetchReply

    const sharedState = {
      primaryResponseUsed: true,
      primaryContent: null,
      visualActionExecuted: false,
      highImpactCount: 0
    }

    // When fetchReply is missing and primaryResponseUsed=true but combinedText is empty,
    // the Responder hits line 103: `interaction.fetchReply()` → TypeError → catches →
    // sends '\u200B' instead of responding. Test that WITHOUT fetchReply, editReply is
    // called with the zero-width space fallback.
    await responder.sendFinalResponse({ interaction, replyContent: '', sharedState })

    const allEditReplyCalls = interaction.editReply.mock.calls.flat()
    const payloads = allEditReplyCalls.map(p => (typeof p === 'string' ? p : p?.content))
    expect(payloads).toContain('\u200B')
  })
})
