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
    const actionType = (params.action || 'list').toLowerCase().trim()
    const targetName = (params.name || '').toLowerCase().trim().replace(/^\/+/, '')

    // Security Gate: Disabling and enabling slash commands is restricted to the bot owner
    if (['disable', 'enable'].includes(actionType) && !isOwner && !isDM) {
      const deniedMsg = '⛔ **Permission Denied:** Disabling or removing slash commands is restricted to the bot creator.'
      if (channel && typeof channel.send === 'function') await channel.send(deniedMsg).catch(() => {})
      return { success: false, error: 'Permission denied: Disabling/removing slash commands is restricted to the bot creator.' }
    }

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

    if (actionType === 'create') {
      if (!targetName) return { success: false, error: 'Command name is required for create.' }

      const { PermissionFlagsBits } = require('discord.js')
      const isAdmin = isOwner || isDM || Boolean(
        context.memberPermissions?.has?.(PermissionFlagsBits.Administrator) ||
        context.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild) ||
        context.member?.permissions?.has?.(PermissionFlagsBits.Administrator)
      )

      if (!isAdmin && !isDM) {
        const deniedMsg = '⛔ **Permission Denied:** Creating slash commands in a server requires Administrator or Manage Server permissions.'
        if (channel && typeof channel.send === 'function') await channel.send(deniedMsg).catch(() => {})
        return { success: false, error: 'Permission denied: Administrator or Manage Server permissions required.' }
      }

      const isGlobal = isOwner && (isDM || Boolean(params.global))
      const targetGuild = isGlobal ? null : context.guildId
      const res = await commandManager.createSlashCommand({
        name: targetName,
        description: params.description,
        options: params.options,
        code: params.code,
        bot,
        guildId: targetGuild,
        isGlobal,
        userId
      })
      const msg = res.success ? `✨ ${res.message}` : `❌ Failed to create /${targetName}: ${res.error}`
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

    return { success: false, error: `Unknown manage_command action: "${actionType}". Expected "list", "disable", "enable", or "create".` }
  }
}
