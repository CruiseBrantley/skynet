const gatekeeper = require('../util/System1Gatekeeper')
const configManager = require('../util/config_manager')
const inFlightChannels = require('../util/inFlightChannels')
const proactivePersonality = require('../util/chat/proactivePersonality')
const proactiveInsight = require('../util/chat/proactiveInsight')

jest.mock('../util/config_manager')
jest.mock('../util/inFlightChannels')
jest.mock('../util/chat/proactivePersonality')
jest.mock('../util/chat/proactiveInsight')

describe('System1Gatekeeper (Real-time System 1 Sentry)', () => {
  const botId = '558428214805135370'
  const mockClient = { user: { id: botId } }

  beforeEach(() => {
    jest.clearAllMocks()
    gatekeeper.resetCooldowns()
    gatekeeper.reactionCooldownMs = 0
    gatekeeper.interjectCooldownMs = 0
    gatekeeper.insightCooldownMs = 0
    configManager.isProactiveChannelAllowed.mockReturnValue(true)
    inFlightChannels.isChannelInFlight.mockReturnValue(false)
  })

  describe('shouldEvaluate guards', () => {
    test('rejects null message or missing author', () => {
      expect(gatekeeper.shouldEvaluate(null, botId)).toBe(false)
      expect(gatekeeper.shouldEvaluate({}, botId)).toBe(false)
    })

    test('rejects messages from bots', () => {
      const msg = { author: { bot: true, id: '123' }, guildId: 'g1', guild: {}, channel: { id: 'c1' }, content: 'hello' }
      expect(gatekeeper.shouldEvaluate(msg, botId)).toBe(false)
    })

    test('rejects messages from Skynet self', () => {
      const msg = { author: { bot: false, id: botId }, guildId: 'g1', guild: {}, channel: { id: 'c1' }, content: 'hello' }
      expect(gatekeeper.shouldEvaluate(msg, botId)).toBe(false)
    })

    test('rejects DMs or messages without guild', () => {
      const msg = { author: { bot: false, id: 'user1' }, guildId: null, guild: null, channel: { id: 'c1' }, content: 'hello' }
      expect(gatekeeper.shouldEvaluate(msg, botId)).toBe(false)
    })

    test('rejects direct user mentions', () => {
      const msg = {
        author: { bot: false, id: 'user1' },
        guildId: 'g1',
        guild: {},
        channel: { id: 'c1' },
        content: `<@${botId}> what is the weather?`,
        mentions: { has: jest.fn().mockReturnValue(true) }
      }
      expect(gatekeeper.shouldEvaluate(msg, botId)).toBe(false)
    })

    test('rejects replies to bot', () => {
      const msg = {
        author: { bot: false, id: 'user1' },
        guildId: 'g1',
        guild: {},
        channel: { id: 'c1' },
        content: 'thanks bot',
        reference: { messageId: 'm1' },
        mentions: { repliedUser: { id: botId } }
      }
      expect(gatekeeper.shouldEvaluate(msg, botId)).toBe(false)
    })

    test('rejects in-flight channels', () => {
      inFlightChannels.isChannelInFlight.mockReturnValue(true)
      const msg = { author: { bot: false, id: 'user1' }, guildId: 'g1', guild: {}, channel: { id: 'c1' }, content: 'hello world' }
      expect(gatekeeper.shouldEvaluate(msg, botId)).toBe(false)
    })

    test('rejects disallowed proactive channels', () => {
      configManager.isProactiveChannelAllowed.mockReturnValue(false)
      const msg = { author: { bot: false, id: 'user1' }, guildId: 'g1', guild: {}, channel: { id: 'c1', name: 'spam' }, content: 'hello world' }
      expect(gatekeeper.shouldEvaluate(msg, botId)).toBe(false)
    })

    test('rejects empty or whitespace-only messages', () => {
      const msg1 = { author: { bot: false, id: 'user1' }, guildId: 'g1', guild: {}, channel: { id: 'c1' }, content: '' }
      const msg2 = { author: { bot: false, id: 'user1' }, guildId: 'g1', guild: {}, channel: { id: 'c1' }, content: '   ' }
      expect(gatekeeper.shouldEvaluate(msg1, botId)).toBe(false)
      expect(gatekeeper.shouldEvaluate(msg2, botId)).toBe(false)
    })

    test('allows short conversational messages for context evaluation', () => {
      const msg = { author: { bot: false, id: 'user1' }, guildId: 'g1', guild: {}, channel: { id: 'c1' }, content: 'yea' }
      expect(gatekeeper.shouldEvaluate(msg, botId)).toBe(true)
    })

    test('rejects when reaction, interjection, and insight cooldowns are all active', () => {
      gatekeeper.reactionCooldownMs = 60000
      gatekeeper.interjectCooldownMs = 60000
      gatekeeper.insightCooldownMs = 60000
      gatekeeper.lastReactionTimeByChannel.set('c1', Date.now())
      gatekeeper.lastInterjectTimeByChannel.set('c1', Date.now())
      gatekeeper.lastInsightTimeByChannel.set('c1', Date.now())
      const msg = { author: { bot: false, id: 'user1' }, guildId: 'g1', guild: {}, channel: { id: 'c1' }, content: 'this is a full message' }
      expect(gatekeeper.shouldEvaluate(msg, botId)).toBe(false)
    })

    test('allows valid unmentioned message when at least one cooldown is available', () => {
      gatekeeper.reactionCooldownMs = 60000
      gatekeeper.interjectCooldownMs = 60000
      gatekeeper.insightCooldownMs = 60000
      gatekeeper.lastReactionTimeByChannel.set('c1', Date.now())
      gatekeeper.lastInterjectTimeByChannel.set('c1', Date.now())
      // insight is NOT on cooldown
      const msg = { author: { bot: false, id: 'user1' }, guildId: 'g1', guild: {}, channel: { id: 'c1' }, content: 'this is a valid message' }
      expect(gatekeeper.shouldEvaluate(msg, botId)).toBe(true)
    })
  })

  describe('evaluateMessage', () => {
    test('ignores messages with low probability scores', async () => {
      const msg = {
        author: { bot: false, id: 'user1' },
        guildId: 'g1',
        guild: {},
        channel: { id: 'c1', name: 'general' },
        content: 'just drinking some coffee'
      }

      jest.spyOn(gatekeeper.client, 'systemOne').mockResolvedValueOnce({
        answers: {
          reaction: { noul: 0.12 },
          interject: { noul: 0.05 }
        }
      })

      const res = await gatekeeper.evaluateMessage(msg, mockClient, {})
      expect(res).toMatchObject({ action: 'ignore' })
      expect(proactivePersonality.selectProactiveEmoji).not.toHaveBeenCalled()
      expect(proactivePersonality.executeProactiveInterjection).not.toHaveBeenCalled()
    })

    test('triggers reaction when reaction probability exceeds threshold', async () => {
      const msg = {
        author: { bot: false, id: 'user1' },
        guildId: 'g1',
        guild: {},
        channel: { id: 'c1', name: 'general' },
        content: 'BRO I JUST ACCIDENTALLY DELETED PROD LMAOOOO'
      }

      jest.spyOn(gatekeeper.client, 'systemOne').mockResolvedValueOnce({
        answers: {
          reaction: { noul: 0.92 },
          interject: { noul: 0.10 }
        }
      })

      const res = await gatekeeper.evaluateMessage(msg, mockClient, {})
      expect(res).toMatchObject({ action: 'react', score: 0.92 })
      expect(gatekeeper.lastReactionTimeByChannel.has('c1')).toBe(true)
      // Allow async setImmediate to tick
      await new Promise(resolve => setImmediate(resolve))
      expect(proactivePersonality.selectProactiveEmoji).toHaveBeenCalledWith(msg)
    })

    test('triggers interjection when interject probability exceeds threshold', async () => {
      const msg = {
        author: { bot: false, id: 'user1' },
        guildId: 'g1',
        guild: {},
        channel: { id: 'c1', name: 'general' },
        content: 'Hey can someone tell me what commands Skynet has available?'
      }

      jest.spyOn(gatekeeper.client, 'systemOne').mockResolvedValueOnce({
        answers: {
          reaction: { noul: 0.05 },
          interject: { noul: 0.88 }
        }
      })

      const res = await gatekeeper.evaluateMessage(msg, mockClient, {})
      expect(res).toMatchObject({ action: 'interject', score: 0.88 })
      expect(gatekeeper.lastInterjectTimeByChannel.has('c1')).toBe(true)
      await new Promise(resolve => setImmediate(resolve))
      expect(proactivePersonality.executeProactiveInterjection).toHaveBeenCalled()
    })

    test('triggers both reaction and interjection when both probabilities exceed threshold', async () => {
      const msg = {
        author: { bot: false, id: 'user1' },
        guildId: 'g1',
        guild: {},
        channel: { id: 'c1', name: 'general' },
        content: 'Skynet, did you really just delete the database? LMAOOOO'
      }

      jest.spyOn(gatekeeper.client, 'systemOne').mockResolvedValueOnce({
        answers: {
          reaction: { noul: 0.95 },
          interject: { noul: 0.90 }
        }
      })

      const res = await gatekeeper.evaluateMessage(msg, mockClient, {})
      expect(res).toMatchObject({ action: 'interject+react', actions: ['interject', 'react'] })
      expect(gatekeeper.lastReactionTimeByChannel.has('c1')).toBe(true)
      expect(gatekeeper.lastInterjectTimeByChannel.has('c1')).toBe(true)
      await new Promise(resolve => setImmediate(resolve))
      expect(proactivePersonality.selectProactiveEmoji).toHaveBeenCalledWith(msg)
      expect(proactivePersonality.executeProactiveInterjection).toHaveBeenCalled()
    })

    test('evaluates short response using recent channel message history for context', async () => {
      const channelMessagesCache = new Map()
      channelMessagesCache.set('m1', {
        id: 'm1',
        content: 'Would you like me to check the schedule?',
        createdTimestamp: 1000,
        author: { id: botId, username: 'Skynet' }
      })
      channelMessagesCache.set('m2', {
        id: 'm2',
        content: 'yea',
        createdTimestamp: 2000,
        author: { id: 'user1', username: 'sirian' }
      })

      const msg = {
        author: { bot: false, id: 'user1' },
        guildId: 'g1',
        guild: {},
        channel: { id: 'c1', name: 'general', messages: { cache: channelMessagesCache } },
        content: 'yea'
      }

      const spy = jest.spyOn(gatekeeper.client, 'systemOne').mockResolvedValueOnce({
        answers: {
          interject: { noul: 0.92 }
        }
      })

      const res = await gatekeeper.evaluateMessage(msg, mockClient, {})
      expect(res).toMatchObject({ action: 'interject', score: 0.92 })
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        state: '[Skynet (bot)]: Would you like me to check the schedule?\n[sirian]: yea'
      }))
    })

    test('triggers topic insight when insight probability exceeds threshold', async () => {
      const msg = {
        author: { bot: false, id: 'user1' },
        guildId: 'g1',
        guild: {},
        channel: { id: 'c1', name: 'tech-chat' },
        content: 'Anyone know why my node server crashes with ERR_HTTP_HEADERS_SENT?'
      }

      jest.spyOn(gatekeeper.client, 'systemOne').mockResolvedValueOnce({
        answers: {
          reaction: { noul: 0.10 },
          interject: { noul: 0.20 },
          insight: { noul: 0.91 }
        }
      })

      const res = await gatekeeper.evaluateMessage(msg, mockClient, {})
      expect(res).toMatchObject({ action: 'insight', score: 0.91 })
      expect(gatekeeper.lastInsightTimeByChannel.has('c1')).toBe(true)
      await new Promise(resolve => setImmediate(resolve))
      expect(proactiveInsight.executeProactiveInsight).toHaveBeenCalledWith(msg, mockClient)
    })

    test('does not block consecutive interjections when cooldowns are disabled (0ms)', async () => {
      gatekeeper.interjectCooldownMs = 0
      const msg1 = {
        author: { bot: false, id: 'user1' },
        guildId: 'g1',
        guild: {},
        channel: { id: 'c1', name: 'general' },
        content: 'Skynet, what time is it?'
      }
      const msg2 = {
        author: { bot: false, id: 'user1' },
        guildId: 'g1',
        guild: {},
        channel: { id: 'c1', name: 'general' },
        content: 'Skynet, and what is the date?'
      }

      jest.spyOn(gatekeeper.client, 'systemOne')
        .mockResolvedValueOnce({ answers: { interject: { noul: 0.90 } } })
        .mockResolvedValueOnce({ answers: { interject: { noul: 0.92 } } })

      const res1 = await gatekeeper.evaluateMessage(msg1, mockClient, {})
      expect(res1).toMatchObject({ action: 'interject' })

      const res2 = await gatekeeper.evaluateMessage(msg2, mockClient, {})
      expect(res2).toMatchObject({ action: 'interject' })
    })

    test('handles connection refusal gracefully without throwing', async () => {
      const msg = {
        author: { bot: false, id: 'user1' },
        guildId: 'g1',
        guild: {},
        channel: { id: 'c1', name: 'general' },
        content: 'testing connection failure'
      }

      const connErr = new Error('connect ECONNREFUSED 127.0.0.1:8000')
      connErr.code = 'ECONNREFUSED'
      jest.spyOn(gatekeeper.client, 'systemOne').mockRejectedValueOnce(connErr)

      const res = await gatekeeper.evaluateMessage(msg, mockClient, {})
      expect(res).toBeNull()
      expect(proactivePersonality.selectProactiveEmoji).not.toHaveBeenCalled()
    })

    test('truncates prior long summary messages in history while keeping current message intact', async () => {
      const channelMessagesCache = new Map()
      const longSummary = 'A'.repeat(500)
      channelMessagesCache.set('m1', {
        id: 'm1',
        content: longSummary,
        createdTimestamp: 1000,
        author: { id: botId, username: 'Skynet' }
      })
      channelMessagesCache.set('m2', {
        id: 'm2',
        content: 'Ollama also launched System One api today, link their blog or docs on that Skynet',
        createdTimestamp: 2000,
        author: { id: 'user1', username: 'sirian' }
      })

      const msg = {
        id: 'm2',
        author: { bot: false, id: 'user1', username: 'sirian' },
        guildId: 'g1',
        guild: {},
        channel: { id: 'c1', name: 'general', messages: { cache: channelMessagesCache } },
        content: 'Ollama also launched System One api today, link their blog or docs on that Skynet'
      }

      const spy = jest.spyOn(gatekeeper.client, 'systemOne').mockResolvedValueOnce({
        answers: {
          interject: { noul: 0.95 }
        }
      })

      const res = await gatekeeper.evaluateMessage(msg, mockClient, {})
      expect(res).toMatchObject({ action: 'interject' })
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        state: expect.stringContaining(`[Skynet (bot)]: ${'A'.repeat(300)}...`)
      }))
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        state: expect.stringContaining('[sirian]: Ollama also launched System One api today, link their blog or docs on that Skynet')
      }))
    })

    test('triggers interjection with keyword mention of skynet at lower threshold', async () => {
      const msg = {
        author: { bot: false, id: 'user1' },
        guildId: 'g1',
        guild: {},
        channel: { id: 'c1', name: 'general' },
        content: 'Hey Skynet can you help?'
      }

      // Gatekeeper default threshold is 0.80, but score is 0.65; should trigger because "skynet" is mentioned
      jest.spyOn(gatekeeper.client, 'systemOne').mockResolvedValueOnce({
        answers: {
          interject: { noul: 0.65 }
        }
      })

      const res = await gatekeeper.evaluateMessage(msg, mockClient, {})
      expect(res).toMatchObject({ action: 'interject', score: 0.65 })
      expect(gatekeeper.lastInterjectTimeByChannel.has('c1')).toBe(true)
    })

    test('dynamically raises reaction threshold immediately after a reaction and decays back', () => {
      const channelId = 'c-dyn'
      gatekeeper.reactionThreshold = 0.75

      // Base threshold when no prior reactions
      expect(gatekeeper.getEffectiveReactionThreshold(channelId)).toBe(0.75)

      // Immediately after reaction (0s elapsed): penalty +0.18 -> 0.93
      gatekeeper.lastReactionTimeByChannel.set(channelId, Date.now())
      expect(gatekeeper.getEffectiveReactionThreshold(channelId)).toBeCloseTo(0.93, 2)

      // Halfway through decay window (90s / 180s elapsed): penalty +0.09 -> 0.84
      gatekeeper.lastReactionTimeByChannel.set(channelId, Date.now() - 90 * 1000)
      expect(gatekeeper.getEffectiveReactionThreshold(channelId)).toBeCloseTo(0.84, 2)

      // After decay window (181s elapsed): penalty decayed to 0 -> 0.75
      gatekeeper.lastReactionTimeByChannel.set(channelId, Date.now() - 181 * 1000)
      expect(gatekeeper.getEffectiveReactionThreshold(channelId)).toBe(0.75)
    })

    test('allows exceptional message to react even during dynamic decay window', async () => {
      const channelId = 'c-high'
      gatekeeper.reactionThreshold = 0.75
      gatekeeper.lastReactionTimeByChannel.set(channelId, Date.now() - 1000) // ~1s ago, effective threshold ~0.93

      const msg = {
        author: { bot: false, id: 'user1' },
        guildId: 'g1',
        guild: {},
        channel: { id: channelId, name: 'general' },
        content: 'HOLY SHIT THE ENTIRE SERVER CRASHED'
      }

      // Borderline score 0.80 (< 0.93) is ignored
      jest.spyOn(gatekeeper.client, 'systemOne').mockResolvedValueOnce({
        answers: {
          reaction: { noul: 0.80 },
          interject: { noul: 0.10 }
        }
      })
      const ignoredRes = await gatekeeper.evaluateMessage(msg, mockClient, {})
      expect(ignoredRes.action).toBe('ignore')

      // Exceptional score 0.95 (>= 0.93) triggers reaction without being blocked by a hard cooldown
      jest.spyOn(gatekeeper.client, 'systemOne').mockResolvedValueOnce({
        answers: {
          reaction: { noul: 0.95 },
          interject: { noul: 0.10 }
        }
      })
      const triggeredRes = await gatekeeper.evaluateMessage(msg, mockClient, {})
      expect(triggeredRes.action).toBe('react')
    })
  })
})


