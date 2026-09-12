const { EmbedBuilder } = require('discord.js')
const commandManager = require('../commandManager')

module.exports = {
  name: 'manage_command',
  description: 'Enables, disables, lists, inspects, creates, or changes registration scope (Global vs Guild ID) for Discord application slash commands (Creator / Admin only)',
  schema: {
    action: {
      type: 'string',
      description: 'Action to perform: "list", "create", "disable", "enable", "inspect", or "set_scope".'
    },
    name: {
      type: 'string',
      description: 'Command name (e.g. "soundboard", "catfact", "netstats").'
    },
    description: {
      type: 'string',
      description: 'Description of what the command does (for create action).'
    },
    code: {
      type: 'string',
      description: 'JavaScript execution code for the slash command (for create action).'
    },
    options: {
      type: 'array',
      description: 'Parameter options array (for create action).'
    },
    guild_id: {
      type: 'string',
      description: 'Target guild ID or "global" (for set_scope action).'
    },
    global: {
      type: 'boolean',
      description: 'Whether command is registered globally (for create action).'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const userId = context.userId || context.user?.id
    const isOwner = userId === process.env.OWNER_ID
    const isDM = !context.guildId
    const actionType = (params.action || 'list').toLowerCase().trim()
    const targetName = (params.name || '').toLowerCase().trim().replace(/^\/+/, '')

    // Security Gate: Disabling, enabling, and scoping slash commands is restricted to the bot owner
    if (['disable', 'enable', 'set_scope'].includes(actionType) && !isOwner && !isDM) {
      const deniedMsg = '⛔ **Permission Denied:** Modifying slash commands is restricted to the bot creator.'
      if (channel && typeof channel.send === 'function') await channel.send(deniedMsg).catch(() => {})
      return { success: false, error: 'Permission denied: Modifying slash commands is restricted to the bot creator.' }
    }

    if (actionType === 'list') {
      const commands = commandManager.listSlashCommands()
      const activeList = commands
        .filter(c => c.enabled)
        .map(c => `• **/${c.name}** — \`${c.scope === 'global' ? 'Global' : `Guild: ${c.guildId}`}\`${c.protected ? ' *(protected)*' : ''}`)
        .join('\n') || 'None'

      const disabledList = commands
        .filter(c => !c.enabled)
        .map(c => `• ~~/${c.name}~~ *(disabled)*`)
        .join('\n') || 'None'

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Slash Command Registry & Scopes')
        .setColor(0x00AEEF)
        .addFields(
          { name: `Active Commands (${commands.filter(c => c.enabled).length})`, value: activeList, inline: false },
          { name: `Disabled Commands (${commands.filter(c => !c.enabled).length})`, value: disabledList, inline: false }
        )
        .setFooter({ text: 'Use /manage_command set_scope <command_name> global' })

      if (channel && typeof channel.send === 'function') {
        await channel.send({ embeds: [embed] }).catch(() => {})
      }
      return { success: true, count: commands.length, commands }
    }

    if (actionType === 'inspect') {
      if (!targetName) return { success: false, error: 'Command name is required for inspect.' }
      const res = commandManager.inspectSlashCommand(targetName)
      return res
    }

    if (actionType === 'set_scope') {
      if (!targetName) return { success: false, error: 'Command name is required for set_scope.' }
      const targetGuildId = params.guild_id || params.guildId || 'global'
      const res = await commandManager.setCommandScope({ name: targetName, guildId: targetGuildId, bot })
      const msg = res.success ? `🌐 ${res.message}` : `❌ Failed to set scope for /${targetName}: ${res.error}`
      if (channel && typeof channel.send === 'function') await channel.send(msg).catch(() => {})
      return res
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

    return { success: false, error: `Unknown manage_command action: "${actionType}". Expected "list", "inspect", "set_scope", "disable", "enable", or "create".` }
  }
}
