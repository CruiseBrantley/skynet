const stateStore = require('../StateStore')

module.exports = {
  name: 'read_state',
  description: 'Reads an operational state baseline or list of stored state keys from the StateStore (e.g. last patch version, weather baseline, game server build ID).',
  schema: {
    key: {
      type: 'string',
      description: 'The state key to read (e.g. "last_diablo_patch", "weather_baseline_fayetteville"). Leave blank to list all keys.'
    },
    compare_with: {
      type: 'any',
      description: 'Optional new value to compare/diff against stored baseline. Returns { hasChanged: true/false }.'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const key = (params.key || '').trim()

    if (!key) {
      const allKeys = stateStore.listKeys()
      return `[SYSTEM: Stored State Keys (${allKeys.length}):\n${allKeys.map(k => `• \`${k}\``).join('\n') || 'None'}\n\nSpecify "key" to read a specific state value.]`
    }

    if (params.compare_with !== undefined) {
      const diffResult = stateStore.diff(key, params.compare_with)
      return `[SYSTEM: State Diff for "${key}":\n\`\`\`json\n${JSON.stringify(diffResult, null, 2)}\n\`\`\`]`
    }

    const entry = stateStore.getEntry(key)
    if (!entry) {
      return `[SYSTEM: State key "${key}" is not set or has expired.]`
    }

    return `[SYSTEM: State Value for "${key}" (Updated: ${entry.updatedAtIso}):\n\`\`\`json\n${JSON.stringify(entry.value, null, 2)}\n\`\`\`]`
  }
}
