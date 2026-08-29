const commandManager = require('../commandManager')

module.exports = {
  name: 'deploy_slash_commands',
  description: 'Deploys or refreshes slash commands with Discord REST API (target: "global", specific guild ID, or all).',
  schema: {
    target: 'string — "global", "all", or a specific Guild ID to deploy slash commands to (default: "global")'
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const target = params.target || params.guild_id || params.scope || 'global'
    const res = await commandManager.deploySlashCommands(target === 'all' ? undefined : target)

    if (res.success) {
      return `[SYSTEM: Successfully deployed and synchronized slash commands (${target}): ${res.count} commands active on Discord.]`
    }
    return `[SYSTEM: Error deploying slash commands: ${res.error}]`
  }
}
