const agentMemory = require('./AgentMemory')
const logger = require('../logger')

/**
 * Recognized proactive settings & default values per guild
 */
const PROACTIVE_SETTINGS = {
  proactive_presence: { name: 'Conversational Interjections', type: 'boolean', default: true },
  proactive_reactions: { name: 'Emoji / GIF Reactions', type: 'boolean', default: true },
  game_patch_notes: { name: 'Proactive Game Patch Notes', type: 'boolean', default: false },
  proactive_channels: { name: 'Allowed Channels for Presence', type: 'string', default: 'all' },
  patch_channels: { name: 'Channels for Game Patch Notes', type: 'string', default: '' }
}

/**
 * Get a specific proactive setting for a guild.
 * @param {string} settingKey
 * @param {string|null} guildId
 */
function getProactiveSetting (settingKey, guildId = null) {
  const meta = PROACTIVE_SETTINGS[settingKey]
  if (!meta) return null
  if (!guildId) return meta.default // DMs use defaults

  const key = `server.proactive.${settingKey}`
  const val = agentMemory.get(key, guildId)
  if (val === null || val === undefined) {
    return meta.default
  }

  if (meta.type === 'boolean') {
    return val === 'true' || val === '1'
  }
  return String(val)
}

/**
 * Set a proactive setting for a guild.
 * @param {string} settingKey
 * @param {boolean|string} value
 * @param {string} guildId
 */
function setProactiveSetting (settingKey, value, guildId) {
  const meta = PROACTIVE_SETTINGS[settingKey]
  if (!meta) {
    throw new Error(`Unknown proactive setting: "${settingKey}"`)
  }
  if (!guildId) {
    throw new Error('Guild ID is required to set proactive settings.')
  }

  const key = `server.proactive.${settingKey}`
  const valStr = meta.type === 'boolean' ? (value ? 'true' : 'false') : String(value)
  agentMemory.set(key, valStr, -1, guildId)
  logger.info(`ConfigManager: Proactive setting "${settingKey}" set to "${valStr}" for guild ${guildId}`)
  return value
}

/**
 * Helper to check if a channel is matched by a comma-separated list of channel IDs/names or "all".
 */
function matchesChannelList (channelId, channelName, channelListStr) {
  if (!channelListStr || !channelListStr.trim()) return false
  const list = channelListStr.toLowerCase().split(',').map(s => s.trim().replace(/^#/, ''))
  if (list.includes('all')) return true

  const idMatch = channelId && list.includes(channelId.toLowerCase())
  const nameMatch = channelName && list.includes(channelName.toLowerCase().replace(/^#/, ''))
  return idMatch || nameMatch
}

/**
 * Check if proactive conversational interjections/presence are allowed in a channel.
 */
function isProactiveChannelAllowed (guildId, channelId, channelName) {
  const presenceEnabled = getProactiveSetting('proactive_presence', guildId)
  if (!presenceEnabled) return false

  const channelsList = getProactiveSetting('proactive_channels', guildId)
  return matchesChannelList(channelId, channelName, channelsList)
}

/**
 * Check if proactive game patch notes are allowed in a channel.
 */
function isPatchChannelAllowed (guildId, channelId, channelName) {
  const patchEnabled = getProactiveSetting('game_patch_notes', guildId)
  if (!patchEnabled) return false

  const channelsList = getProactiveSetting('patch_channels', guildId)
  return matchesChannelList(channelId, channelName, channelsList)
}

/**
 * Get all proactive configuration states for a guild.
 * @param {string|null} guildId
 */
function getGuildProactiveConfig (guildId = null) {
  const config = {}
  for (const [key, meta] of Object.entries(PROACTIVE_SETTINGS)) {
    config[key] = {
      name: meta.name,
      value: getProactiveSetting(key, guildId)
    }
  }
  return config
}

module.exports = {
  PROACTIVE_SETTINGS,
  getProactiveSetting,
  setProactiveSetting,
  isProactiveChannelAllowed,
  isPatchChannelAllowed,
  getGuildProactiveConfig
}
