const fs = require('fs')
const path = require('path')
const { REST, Routes } = require('discord.js')
const logger = require('../logger')

const COMMANDS_DIR = path.join(__dirname, '../commands')
const PROTECTED_COMMANDS = new Set(['server', 'config', 'chat', 'ping'])

/**
 * Reusable helper to re-deploy all active slash commands to Discord REST API.
 * @returns {Promise<{ success: boolean, count?: number, error?: string }>}
 */
async function deploySlashCommands () {
  const token = process.env.TOKEN
  const clientId = process.env.CLIENT_ID
  const guildId = process.env.GUILD_ID

  if (!token || !clientId) {
    return { success: false, error: 'Missing TOKEN or CLIENT_ID in environment variables.' }
  }

  try {
    const commands = []
    const commandFiles = fs.readdirSync(COMMANDS_DIR).filter(file => file.endsWith('.js') && file !== 'chat.js')

    for (const file of commandFiles) {
      const fullPath = path.join(COMMANDS_DIR, file)
      delete require.cache[require.resolve(fullPath)]
      const command = require(fullPath)
      if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON())
      }
    }

    const rest = new REST({ version: '10' }).setToken(token)
    logger.info(`commandManager: Deploying ${commands.length} application (/) commands to Discord...`)

    const data = await rest.put(
      guildId
        ? Routes.applicationGuildCommands(clientId, guildId)
        : Routes.applicationCommands(clientId),
      { body: commands }
    )

    logger.info(`commandManager: Successfully reloaded ${data.length} application (/) commands on Discord.`)
    return { success: true, count: data.length }
  } catch (err) {
    logger.error(`commandManager: Failed to deploy slash commands: ${err.message}`)
    return { success: false, error: err.message }
  }
}

/**
 * Lists all slash commands with their status (active vs disabled).
 */
function listSlashCommands () {
  if (!fs.existsSync(COMMANDS_DIR)) return []
  const files = fs.readdirSync(COMMANDS_DIR)
  const result = []

  for (const file of files) {
    if (file.endsWith('.js') && file !== 'chat.js') {
      const name = file.replace(/\.js$/, '')
      result.push({ name, file, enabled: true, protected: PROTECTED_COMMANDS.has(name) })
    } else if (file.endsWith('.js.disabled')) {
      const name = file.replace(/\.js\.disabled$/, '')
      result.push({ name, file, enabled: false, protected: false })
    }
  }

  return result
}

/**
 * Disables a slash command, unloads it, and refreshes Discord command registration.
 * @param {string} name
 * @param {import('discord.js').Client} [bot]
 * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
 */
async function disableSlashCommand (name, bot) {
  const cleanName = (name || '').trim().toLowerCase().replace(/^\/+/, '')
  if (!cleanName) return { success: false, error: 'Command name is required.' }

  if (PROTECTED_COMMANDS.has(cleanName)) {
    return { success: false, error: `Command "/${cleanName}" is a core protected command and cannot be disabled.` }
  }

  const activePath = path.join(COMMANDS_DIR, `${cleanName}.js`)
  const disabledPath = path.join(COMMANDS_DIR, `${cleanName}.js.disabled`)

  if (!fs.existsSync(activePath)) {
    if (fs.existsSync(disabledPath)) {
      return { success: true, message: `Command "/${cleanName}" is already disabled.` }
    }
    return { success: false, error: `No slash command file found for "/${cleanName}".` }
  }

  try {
    fs.renameSync(activePath, disabledPath)
    try {
      delete require.cache[require.resolve(activePath)]
    } catch (_) {}

    if (bot && bot.commands) {
      bot.commands.delete(cleanName)
    }

    const deployResult = await deploySlashCommands()
    if (!deployResult.success) {
      logger.warn(`commandManager: Command disabled on disk but Discord REST sync failed: ${deployResult.error}`)
    }

    logger.info(`commandManager: Disabled command "/${cleanName}".`)
    return { success: true, message: `Successfully disabled "/${cleanName}" and refreshed Discord slash command registrations.` }
  } catch (err) {
    logger.error(`commandManager: Error disabling command "/${cleanName}": ${err.message}`)
    return { success: false, error: err.message }
  }
}

/**
 * Enables a previously disabled slash command, reloads it into memory, and refreshes Discord registration.
 * @param {string} name
 * @param {import('discord.js').Client} [bot]
 * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
 */
async function enableSlashCommand (name, bot) {
  const cleanName = (name || '').trim().toLowerCase().replace(/^\/+/, '')
  if (!cleanName) return { success: false, error: 'Command name is required.' }

  const activePath = path.join(COMMANDS_DIR, `${cleanName}.js`)
  const disabledPath = path.join(COMMANDS_DIR, `${cleanName}.js.disabled`)

  if (fs.existsSync(activePath)) {
    return { success: true, message: `Command "/${cleanName}" is already active.` }
  }

  if (!fs.existsSync(disabledPath)) {
    return { success: false, error: `No disabled file found for "/${cleanName}.js.disabled".` }
  }

  try {
    fs.renameSync(disabledPath, activePath)
    try {
      delete require.cache[require.resolve(activePath)]
    } catch (_) {}
    const command = require(activePath)

    if (bot && bot.commands && 'data' in command && 'execute' in command) {
      bot.commands.set(command.data.name, command)
    }

    const deployResult = await deploySlashCommands()
    if (!deployResult.success) {
      logger.warn(`commandManager: Command enabled on disk but Discord REST sync failed: ${deployResult.error}`)
    }

    logger.info(`commandManager: Enabled command "/${cleanName}".`)
    return { success: true, message: `Successfully enabled "/${cleanName}" and registered it on Discord.` }
  } catch (err) {
    logger.error(`commandManager: Error enabling command "/${cleanName}": ${err.message}`)
    return { success: false, error: err.message }
  }
}

module.exports = {
  deploySlashCommands,
  listSlashCommands,
  disableSlashCommand,
  enableSlashCommand,
  PROTECTED_COMMANDS
}
