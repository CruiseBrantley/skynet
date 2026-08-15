const agentMemory = require('./AgentMemory')
const logger = require('../logger')

// Recognized feature keys for per-server toggling
const SUPPORTED_FEATURES = {
  tldr: { name: 'Channel Digest (/tldr)', default: true },
  research: { name: 'Deep Web Research (/research)', default: true },
  smart_poll: { name: 'Smart Discussion Polls (/smart-poll)', default: true }
}

/**
 * Check if a feature is enabled for a given guild.
 * @param {string} feature - Feature key (e.g. 'tldr', 'research', 'smart_poll')
 * @param {string|null} guildId - Discord Guild ID (null = global / DMs)
 * @returns {boolean}
 */
function isFeatureEnabled (feature, guildId = null) {
  if (!SUPPORTED_FEATURES[feature]) return false
  if (!guildId) return true // DMs always have all features enabled

  const key = `server.feature.${feature}`
  const val = agentMemory.get(key, guildId)
  if (val === null || val === undefined) {
    return SUPPORTED_FEATURES[feature].default
  }
  return val === 'true' || val === '1'
}

/**
 * Toggle or set a feature state for a guild.
 * @param {string} feature
 * @param {boolean} enabled
 * @param {string} guildId
 */
function setFeatureEnabled (feature, enabled, guildId) {
  if (!SUPPORTED_FEATURES[feature]) {
    throw new Error(`Unknown feature key: "${feature}"`)
  }
  if (!guildId) {
    throw new Error('Guild ID is required to set server features.')
  }
  const key = `server.feature.${feature}`
  agentMemory.set(key, enabled ? 'true' : 'false', -1, guildId)
  logger.info(`ConfigManager: Feature "${feature}" set to ${enabled} for guild ${guildId}`)
  return enabled
}

/**
 * Get all feature states for a guild.
 * @param {string|null} guildId
 */
function getGuildConfig (guildId = null) {
  const config = {}
  for (const [key, meta] of Object.entries(SUPPORTED_FEATURES)) {
    config[key] = {
      name: meta.name,
      enabled: isFeatureEnabled(key, guildId)
    }
  }
  return config
}

module.exports = {
  SUPPORTED_FEATURES,
  isFeatureEnabled,
  setFeatureEnabled,
  getGuildConfig
}
