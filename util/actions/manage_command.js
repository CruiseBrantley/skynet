const { EmbedBuilder } = require('discord.js')
const commandManager = require('../commandManager')

module.exports = {
  name: 'manage_command',
  description: 'Enables, disables, or lists registered Discord application slash commands (Creator / Admin only)',
  schema: {
    action: 'string — "disable", "enable", or "list"',
    name: 'string — command name (e.g. "catfact", "music") (required for disable/enable)'
  },
  execute: async (bot, channel, params, context = {}) => {
    const userId = context.userId || context.user?.id
    const isOwner = userId === process.env.OWNER_ID
    const isDM = !context.guildId

    // Security Gate: Only bot owner or direct DMs with owner
    if (!isOwner && !isDM) {
      const deniedMsg = '⛔ **Permission Denied:** Slash command management is restricted to the bot creator.'
      if (channel && typeof channel.send === 'function') await channel.send(deniedMsg).catch(() => {})
      return { success: false, error: 'Permission denied: owner only.' }
    }

    const actionType = (params.action || 'list').toLowerCase().trim()
    const targetName = (params.name || '').toLowerCase().trim().replace(/^\/+/, '')

    if (actionType === 'list') {
      const commands = commandManager.listSlashCommands()
      const activeList = commands.filter(c => c.enabled).map(c => `• **/${c.name}**${c.protected ? ' *(protected)*' : ''}`).join('\n') || 'None'
      const disabledList = commands.filter(c => !c.enabled).map(c => `• ~~/${c.name}~~ *(disabled)*`).join('\n') || 'None'

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Slash Command Registry')
        .setColor(0x00AEEF)
        .addFields(
          { name: `Active Commands (${commands.filter(c => c.enabled).length})`, value: activeList, inline: false },
          { name: `Disabled Commands (${commands.filter(c => !c.enabled).length})`, value: disabledList, inline: false }
        )
        .setFooter({ text: 'Use <<<RUN_COMMAND: {"command": "manage_command", "action": "disable", "name": "command_name"}>>>' })

      if (channel && typeof channel.send === 'function') {
        await channel.send({ embeds: [embed] }).catch(() => {})
      }
      return { success: true, count: commands.length, commands }
    }

    if (actionType === 'disable') {
      if (!targetName) return { success: false, error: 'Command name is required for disable.' }
      const res = await commandManager.disableSlashCommand(targetName, bot)
      const msg = res.success ? `🛑 ${res.message}` : `❌ Failed to disable /${targetName}: ${res.error}`
      if (channel && typeof channel.send === 'function') await channel.send(msg).catch(() => {})
      return res
    }

    if (actionType === 'enable') {
      if (!targetName) return { success: false, error: 'Command name is required for enable.' }
      const res = await commandManager.enableSlashCommand(targetName, bot)
      const msg = res.success ? `✅ ${res.message}` : `❌ Failed to enable /${targetName}: ${res.error}`
      if (channel && typeof channel.send === 'function') await channel.send(msg).catch(() => {})
      return res
    }

    return { success: false, error: `Unknown manage_command action: "${actionType}". Expected "list", "disable", or "enable".` }
  }
}
