const {
  getProactiveSetting,
  setProactiveSetting,
  isProactiveChannelAllowed,
  isPatchChannelAllowed,
  getGuildProactiveConfig
} = require('../util/config_manager')
const agentMemory = require('../util/AgentMemory')

jest.mock('../logger')
jest.mock('../util/AgentMemory')

describe('config_manager - proactive settings', () => {
  const testGuildId = 'guild_proactive_test_999'
  let memoryStore = {}

  beforeEach(() => {
    jest.clearAllMocks()
    memoryStore = {}
    agentMemory.get.mockImplementation((key) => memoryStore[key] ?? null)
    agentMemory.set.mockImplementation((key, val) => { memoryStore[key] = val })
  })

  test('returns default proactive setting values', () => {
    expect(getProactiveSetting('proactive_presence', testGuildId)).toBe(true)
    expect(getProactiveSetting('proactive_reactions', testGuildId)).toBe(true)
    expect(getProactiveSetting('game_patch_notes', testGuildId)).toBe(false)
    expect(getProactiveSetting('proactive_channels', testGuildId)).toBe('all')
  })

  test('updates proactive setting values', () => {
    setProactiveSetting('proactive_presence', false, testGuildId)
    expect(getProactiveSetting('proactive_presence', testGuildId)).toBe(false)

    setProactiveSetting('game_patch_notes', true, testGuildId)
    expect(getProactiveSetting('game_patch_notes', testGuildId)).toBe(true)

    setProactiveSetting('patch_channels', 'game-news, patch-notes', testGuildId)
    expect(getProactiveSetting('patch_channels', testGuildId)).toBe('game-news, patch-notes')
  })

  test('filters proactive channels correctly', () => {
    setProactiveSetting('proactive_presence', true, testGuildId)
    setProactiveSetting('proactive_channels', 'general, chat-room', testGuildId)

    expect(isProactiveChannelAllowed(testGuildId, '123', 'general')).toBe(true)
    expect(isProactiveChannelAllowed(testGuildId, '456', 'random')).toBe(false)

    // Test "all" wildcard
    setProactiveSetting('proactive_channels', 'all', testGuildId)
    expect(isProactiveChannelAllowed(testGuildId, '456', 'random')).toBe(true)
  })

  test('filters patch channels correctly', () => {
    setProactiveSetting('game_patch_notes', true, testGuildId)
    setProactiveSetting('patch_channels', 'game-news, 999888777', testGuildId)

    expect(isPatchChannelAllowed(testGuildId, '999888777', 'some-channel')).toBe(true)
    expect(isPatchChannelAllowed(testGuildId, '111', 'game-news')).toBe(true)
    expect(isPatchChannelAllowed(testGuildId, '111', 'offtopic')).toBe(false)
  })

  test('returns full proactive guild config map', () => {
    const config = getGuildProactiveConfig(testGuildId)
    expect(config.proactive_presence).toBeDefined()
    expect(config.proactive_presence.name).toBe('Conversational Interjections')
  })
})
