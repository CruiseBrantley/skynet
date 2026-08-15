const { isFeatureEnabled, setFeatureEnabled, getGuildConfig, SUPPORTED_FEATURES } = require('../util/config_manager')
const agentMemory = require('../util/AgentMemory')

jest.mock('../logger')

describe('config_manager', () => {
  const testGuildId = 'guild_config_123'

  test('returns default values when unset', () => {
    expect(isFeatureEnabled('tldr', testGuildId)).toBe(true)
    expect(isFeatureEnabled('research', testGuildId)).toBe(true)
    expect(isFeatureEnabled('smart_poll', testGuildId)).toBe(true)
    expect(isFeatureEnabled('unknown_feature', testGuildId)).toBe(false)
  })

  test('always enables features in DM context (guildId = null)', () => {
    expect(isFeatureEnabled('tldr', null)).toBe(true)
  })

  test('toggles features per guild', () => {
    setFeatureEnabled('tldr', false, testGuildId)
    expect(isFeatureEnabled('tldr', testGuildId)).toBe(false)

    setFeatureEnabled('tldr', true, testGuildId)
    expect(isFeatureEnabled('tldr', testGuildId)).toBe(true)
  })

  test('returns full guild config map', () => {
    const config = getGuildConfig(testGuildId)
    expect(config.tldr).toBeDefined()
    expect(config.tldr.name).toBe('Channel Digest (/tldr)')
    expect(config.tldr.enabled).toBe(true)
  })
})
