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

/**
 * Creates and deploys a new Discord application slash command.
 * @param {object} options
 * @param {string} options.name - 1-32 lowercase alphanumeric characters
 * @param {string} [options.description] - 1-100 characters description
 * @param {string} options.code - The execute function body or complete file module.exports
 * @param {import('discord.js').Client} [options.bot]
 * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
 */
async function createSlashCommand ({ name, description, code, bot }) {
  const cleanName = (name || '').trim().toLowerCase().replace(/^\/+/, '')
  if (!cleanName || !/^[a-z0-9_-]{1,32}$/.test(cleanName)) {
    return { success: false, error: 'Command name must be 1–32 lowercase alphanumeric characters/hyphens/underscores.' }
  }

  if (PROTECTED_COMMANDS.has(cleanName)) {
    return { success: false, error: `Command "/${cleanName}" is a protected core command and cannot be overwritten.` }
  }

  if (!code || typeof code !== 'string') {
    return { success: false, error: 'Executable code is required.' }
  }

  // Security pattern scan
  const actionExecutor = require('./ActionExecutor')
  const forbiddenPatterns = actionExecutor.FORBIDDEN_PATTERNS || []
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(code)) {
      const hit = code.match(pattern)?.[0]
      logger.warn(`commandManager: Rejected new slash command "/${cleanName}" — forbidden pattern: "${hit}"`)
      return { success: false, error: `Forbidden operation detected: "${hit}". Only Discord.js APIs are allowed.` }
    }
  }

  let fileContent = code.trim()
  // If code is just a function body, wrap it in a standard SlashCommand module
  if (!fileContent.includes('SlashCommandBuilder') && !fileContent.includes('module.exports')) {
    const desc = (description || `Execute ${cleanName}`).substring(0, 100)
    fileContent = `// Auto-generated slash command: ${cleanName}
// Created: ${new Date().toISOString()}

const { SlashCommandBuilder } = require('discord.js')

module.exports = {
  data: new SlashCommandBuilder()
    .setName(${JSON.stringify(cleanName)})
    .setDescription(${JSON.stringify(desc)}),
  execute: async (interaction) => {
${code.split('\n').map(l => '    ' + l).join('\n')}
  }
}
`
  }

  // Validate syntax
  try {
    new Function('require', 'module', 'exports', fileContent) // eslint-disable-line no-new-func, no-new
  } catch (e) {
    return { success: false, error: `Syntax error in slash command code: ${e.message}` }
  }

  const targetPath = path.join(COMMANDS_DIR, `${cleanName}.js`)

  try {
    fs.writeFileSync(targetPath, fileContent, 'utf8')
    try {
      delete require.cache[require.resolve(targetPath)]
    } catch (_) {}

    const command = require(targetPath)
    if (bot && bot.commands && 'data' in command && 'execute' in command) {
      bot.commands.set(command.data.name, command)
    }

    const deployResult = await deploySlashCommands()
    if (!deployResult.success) {
      return { success: false, error: `Command written to disk but Discord registration failed: ${deployResult.error}` }
    }

    logger.info(`commandManager: Successfully created and published new slash command "/${cleanName}" to Discord.`)
    return { success: true, message: `Successfully created and deployed new slash command "/${cleanName}" live on Discord!` }
  } catch (err) {
    logger.error(`commandManager: Failed to write and publish command "/${cleanName}": ${err.message}`)
    return { success: false, error: err.message }
  }
}

module.exports = {
  deploySlashCommands,
  listSlashCommands,
  disableSlashCommand,
  enableSlashCommand,
  createSlashCommand,
  PROTECTED_COMMANDS
}
