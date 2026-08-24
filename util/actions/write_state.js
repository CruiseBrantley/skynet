const stateStore = require('../StateStore')

module.exports = {
  name: 'write_state',
  description: 'Writes or updates an operational state baseline in StateStore (e.g. tracking latest patch version, build ID, or weather report hash).',
  schema: {
    key: {
      type: 'string',
      description: 'The state key to write or update (e.g. "last_diablo_patch", "last_stream_status").'
    },
    value: {
      type: 'any',
      description: 'The value to store (string, number, object, or array).'
    },
    ttl_days: {
      type: 'integer',
      description: 'Retention period in days (default: 30 days, 0 for indefinite).'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const key = (params.key || '').trim()
    if (!key) return '[SYSTEM: Error: "key" is required for write_state.]'
    if (params.value === undefined) return '[SYSTEM: Error: "value" is required for write_state.]'

    const ttlDays = params.ttl_days !== undefined ? parseInt(params.ttl_days) : 30
    try {
      const entry = stateStore.set(key, params.value, { ttlDays })
      return `[SYSTEM: Successfully saved state for "${key}" (TTL: ${ttlDays > 0 ? `${ttlDays} days` : 'Permanent'}, Updated: ${entry.updatedAtIso}).]`
    } catch (err) {
      return `[SYSTEM: Failed to write state: ${err.message}]`
    }
  }
}
