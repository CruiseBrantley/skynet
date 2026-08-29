const commandManager = require('../commandManager')

module.exports = {
  name: 'create_slash_command',
  description: 'Creates and deploys a new Discord application (/) slash command with optional parameters and custom JavaScript execution logic (Creator/Admin only).',
  schema: {
    name: 'string — command name (1-32 lowercase alphanumeric characters, e.g. "soundboard", "dice")',
    description: 'string — description of what the command does (1-100 characters)',
    options: 'array — list of parameters [{ name: "sound", description: "sound name", type: "string", required: true }]',
    code: 'string — JavaScript function body for execute(interaction) or full module code',
    global: 'boolean — true to deploy globally to all servers, false for guild-only (default: false)'
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const userId = context.userId || context.user?.id
    const isOwner = userId === process.env.OWNER_ID
    const isDM = !context.guildId

    let targetName = (params.name || params.command_name || params.command || params.commandName || params.title || '').toLowerCase().trim().replace(/^\/+/, '')

    // Fallback: Infer name from description or code if omitted
    if (!targetName && params.description) {
      const match = params.description.match(/\b([a-z0-9_-]{2,20})\s+(soundboard|command|game|tool|utility)\b/i) ||
                    params.description.match(/\b(soundboard|dice|roll|flip|weather|music|calc)\b/i)
      if (match) targetName = match[1].toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    }

    if (!targetName && params.code) {
      const match = params.code.match(/setName\(['"`]([a-z0-9_-]+)['"`]\)/i)
      if (match) targetName = match[1].toLowerCase()
    }

    if (!targetName && JSON.stringify(params).toLowerCase().includes('sound')) {
      targetName = 'soundboard'
    }

    if (!targetName) {
      return '[SYSTEM: Error: "name" is required for create_slash_command (e.g. {"name": "soundboard", "description": "...", "code": "..."}).]'
    }

    const { PermissionFlagsBits } = require('discord.js')
    const isAdmin = isOwner || isDM || Boolean(
      context.memberPermissions?.has?.(PermissionFlagsBits.Administrator) ||
      context.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild) ||
      context.member?.permissions?.has?.(PermissionFlagsBits.Administrator)
    )

    if (!isAdmin && !isDM) {
      return '[SYSTEM: Permission denied: Administrator or Manage Server permissions required.]'
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

    if (res.success) {
      return `[SYSTEM: Successfully created and deployed slash command "/${targetName}" (${isGlobal ? 'Global' : `Guild: ${targetGuild}`}).]`
    }
    return `[SYSTEM: Failed to create slash command "/${targetName}": ${res.error}]`
  }
}
