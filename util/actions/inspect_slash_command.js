const commandManager = require('../commandManager')

module.exports = {
  name: 'inspect_slash_command',
  description: 'Inspects and reads the source code of an existing slash command.',
  schema: {
    name: 'string — name of the slash command to inspect (e.g. "catfact", "music")'
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    let targetName = (params.name || params.command || params.command_name || params.cmd || '').toLowerCase().trim().replace(/^\/+/, '')

    // Fallback: If no name is provided, find the most recently created or relevant slash command
    if (!targetName) {
      const allCommands = commandManager.listSlashCommands()
      if (allCommands.length > 0) {
        // Look for custom dynamic commands or recently added commands
        const dynamicCmd = allCommands.find(c => ['soundboard', 'dice', 'roll'].includes(c.name)) || allCommands[0]
        targetName = dynamicCmd.name
      }
    }

    if (!targetName) return '[SYSTEM: Error: "name" is required to inspect a slash command (e.g. {"name": "soundboard"}).]'
    const res = commandManager.inspectSlashCommand(targetName)
    if (res.success) {
      return `[SYSTEM: Source code for "/${res.name}" (Status: ${res.enabled ? 'Active' : 'Disabled'}):\n\`\`\`javascript\n${res.content}\n\`\`\`]`
    }
    return `[SYSTEM: Error: ${res.error}]`
  }
}
