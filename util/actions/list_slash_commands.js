const commandManager = require('../commandManager')

module.exports = {
  name: 'list_slash_commands',
  description: 'Lists all registered Discord application (/) slash commands and their enabled/disabled status.',
  schema: {},
  execute: async (bot, channel, params = {}, context = {}) => {
    const commands = commandManager.listSlashCommands()
    if (commands.length === 0) {
      return '[SYSTEM: No slash commands registered.]'
    }
    const lines = commands.map(c => `• /${c.name} (${c.enabled ? '🟢 Enabled' : '🔴 Disabled'}, scope: ${c.scope})`)
    return `[SYSTEM: Slash Commands (${commands.length}):\n${lines.join('\n')}]`
  }
}
