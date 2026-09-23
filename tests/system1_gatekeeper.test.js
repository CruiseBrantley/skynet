const gatekeeper = require('../util/System1Gatekeeper')
const configManager = require('../util/config_manager')
const inFlightChannels = require('../util/inFlightChannels')
const proactivePersonality = require('../util/chat/proactivePersonality')

jest.mock('../util/config_manager')
jest.mock('../util/inFlightChannels')
jest.mock('../util/chat/proactivePersonality')

describe('System1Gatekeeper (Real-time Von Sentry)', () => {
  const botId = '558428214805135370'
  const mockClient = { user: { id: botId } }

  beforeEach(() => {
    jest.clearAllMocks()
    gatekeeper.resetCooldowns()
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

    test('rejects messages shorter than 4 characters', () => {
      const msg = { author: { bot: false, id: 'user1' }, guildId: 'g1', guild: {}, channel: { id: 'c1' }, content: 'k' }
      expect(gatekeeper.shouldEvaluate(msg, botId)).toBe(false)
    })

    test('rejects when both reaction and interjection cooldowns are active', () => {
      gatekeeper.lastReactionTimeByChannel.set('c1', Date.now())
      gatekeeper.lastInterjectTimeByChannel.set('c1', Date.now())
      const msg = { author: { bot: false, id: 'user1' }, guildId: 'g1', guild: {}, channel: { id: 'c1' }, content: 'this is a full message' }
      expect(gatekeeper.shouldEvaluate(msg, botId)).toBe(false)
    })

    test('allows valid unmentioned message when at least one cooldown is available', () => {
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
      expect(gatekeeper.isReactionOnCooldown('c1')).toBe(true)
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
      expect(gatekeeper.isInterjectOnCooldown('c1')).toBe(true)
      await new Promise(resolve => setImmediate(resolve))
      expect(proactivePersonality.executeProactiveInterjection).toHaveBeenCalled()
    })

    test('handles Von connection refusal gracefully without throwing', async () => {
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
  })
})
