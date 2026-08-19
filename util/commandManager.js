const fs = require('fs')
const path = require('path')
const { REST, Routes } = require('discord.js')
const logger = require('../logger')

const COMMANDS_DIR = path.join(__dirname, '../commands')
const PROTECTED_COMMANDS = new Set(['server', 'config', 'chat', 'ping'])

/**
 * Reusable helper to deploy slash commands to Discord REST API.
 * @param {string} [targetGuildId] - Specific guild ID, 'global', or undefined (all).
 * @returns {Promise<{ success: boolean, count?: number, error?: string }>}
 */
async function deploySlashCommands (targetGuildId) {
  const token = process.env.TOKEN
  const clientId = process.env.CLIENT_ID

  if (!token || !clientId) {
    return { success: false, error: 'Missing TOKEN or CLIENT_ID in environment variables.' }
  }

  try {
    const globalCommands = []
    const guildCommandsMap = new Map() // guildId -> commands[]
    const commandFiles = fs.readdirSync(COMMANDS_DIR).filter(file => file.endsWith('.js') && file !== 'chat.js')

    for (const file of commandFiles) {
      const fullPath = path.join(COMMANDS_DIR, file)
      delete require.cache[require.resolve(fullPath)]
      const command = require(fullPath)
      if ('data' in command && 'execute' in command) {
        const cmdData = command.data.toJSON()
        const cmdGuildId = command.guildId || null
        if (cmdGuildId && cmdGuildId !== 'global') {
          if (!guildCommandsMap.has(cmdGuildId)) guildCommandsMap.set(cmdGuildId, [])
          guildCommandsMap.get(cmdGuildId).push(cmdData)
        } else {
          globalCommands.push(cmdData)
        }
      }
    }

    const rest = new REST({ version: '10' }).setToken(token)

    // If a specific guild is targeted:
    if (targetGuildId && targetGuildId !== 'global') {
      const guildCommands = guildCommandsMap.get(targetGuildId) || []
      logger.info(`commandManager: Deploying ${guildCommands.length} commands to guild ${targetGuildId}...`)
      const data = await rest.put(
        Routes.applicationGuildCommands(clientId, targetGuildId),
        { body: guildCommands }
      )
      logger.info(`commandManager: Successfully reloaded ${data.length} commands for guild ${targetGuildId}.`)
      return { success: true, count: data.length }
    }

    // If 'global' is targeted:
    if (targetGuildId === 'global') {
      logger.info(`commandManager: Deploying ${globalCommands.length} global commands to Discord...`)
      const data = await rest.put(
        Routes.applicationCommands(clientId),
        { body: globalCommands }
      )
      logger.info(`commandManager: Successfully reloaded ${data.length} global application (/) commands.`)
      return { success: true, count: data.length }
    }

    // If targetGuildId is undefined, deploy global + all discovered guilds:
    logger.info(`commandManager: Deploying ${globalCommands.length} global application (/) commands to Discord...`)
    const globalData = await rest.put(
      Routes.applicationCommands(clientId),
      { body: globalCommands }
    )

    let totalGuildCount = 0
    for (const [gid, cmds] of guildCommandsMap.entries()) {
      logger.info(`commandManager: Deploying ${cmds.length} commands to guild ${gid}...`)
      const gData = await rest.put(
        Routes.applicationGuildCommands(clientId, gid),
        { body: cmds }
      )
      totalGuildCount += gData.length
    }

    return { success: true, count: globalData.length + totalGuildCount }
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
      let guildId = null
      try {
        const cmd = require(path.join(COMMANDS_DIR, file))
        guildId = cmd.guildId || null
      } catch (_) {}
      result.push({ name, file, enabled: true, protected: PROTECTED_COMMANDS.has(name), guildId })
    } else if (file.endsWith('.js.disabled')) {
      const name = file.replace(/\.js\.disabled$/, '')
      result.push({ name, file, enabled: false, protected: false, guildId: null })
    }
  }

  return result
}

/**
 * Reads and inspects the source code of a slash command.
 * @param {string} name
 * @returns {{ success: boolean, name?: string, content?: string, enabled?: boolean, error?: string }}
 */
function inspectSlashCommand (name) {
  const cleanName = (name || '').trim().toLowerCase().replace(/^\/+/, '')
  if (!cleanName) return { success: false, error: 'Command name is required.' }

  const activePath = path.join(COMMANDS_DIR, `${cleanName}.js`)
  const disabledPath = path.join(COMMANDS_DIR, `${cleanName}.js.disabled`)

  if (fs.existsSync(activePath)) {
    const content = fs.readFileSync(activePath, 'utf8')
    return { success: true, name: cleanName, enabled: true, content }
  }

  if (fs.existsSync(disabledPath)) {
    const content = fs.readFileSync(disabledPath, 'utf8')
    return { success: true, name: cleanName, enabled: false, content }
  }

  return { success: false, error: `Command "/${cleanName}" does not exist.` }
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
    let cmdGuildId = null
    try {
      const cmd = require(activePath)
      cmdGuildId = cmd.guildId || null
    } catch (_) {}

    fs.renameSync(activePath, disabledPath)
    try {
      delete require.cache[require.resolve(activePath)]
    } catch (_) {}

    if (bot && bot.commands) {
      bot.commands.delete(cleanName)
    }

    const deployResult = await deploySlashCommands(cmdGuildId || 'global')
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

    const deployResult = await deploySlashCommands(command.guildId || 'global')
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
/**
 * Builds SlashCommandBuilder option chains from explicit options array or extracts them from interaction.options.get* calls.
 */
function buildOptionsChains (optionsInput, code) {
  const rawList = []

  if (Array.isArray(optionsInput)) {
    for (const opt of optionsInput) {
      if (opt && opt.name) {
        rawList.push({
          name: String(opt.name).toLowerCase().replace(/[^a-z0-9_-]/g, '_').substring(0, 32),
          description: (opt.description || opt.name || 'parameter').substring(0, 100),
          type: (opt.type || 'string').toLowerCase().trim(),
          required: !!opt.required
        })
      }
    }
  } else if (optionsInput && typeof optionsInput === 'object') {
    for (const [name, val] of Object.entries(optionsInput)) {
      const cleanName = String(name).toLowerCase().replace(/[^a-z0-9_-]/g, '_').substring(0, 32)
      if (typeof val === 'object' && val !== null) {
        rawList.push({
          name: cleanName,
          description: (val.description || name || 'parameter').substring(0, 100),
          type: (val.type || 'string').toLowerCase().trim(),
          required: !!val.required
        })
      } else if (typeof val === 'string') {
        const isReq = val.toLowerCase().includes('required')
        let type = 'string'
        if (val.toLowerCase().includes('int') || val.toLowerCase().includes('num')) type = 'integer'
        if (val.toLowerCase().includes('bool')) type = 'boolean'
        if (val.toLowerCase().includes('user')) type = 'user'
        if (val.toLowerCase().includes('chan')) type = 'channel'
        if (val.toLowerCase().includes('role')) type = 'role'
        rawList.push({
          name: cleanName,
          description: val.replace(/^(string|number|integer|boolean|user|channel|role)\s*[-—:]\s*/i, '').substring(0, 100) || name,
          type,
          required: isReq
        })
      }
    }
  }

  // If no options were explicitly declared, automatically infer from code
  if (rawList.length === 0 && typeof code === 'string') {
    const matches = [...code.matchAll(/(?:interaction\??\.)?options\??\.get(String|Integer|Number|Boolean|User|Channel|Role|Mentionable|Attachment)\s*\(\s*['"`]([a-zA-Z0-9_-]+)['"`](?:\s*,\s*(true|false))?/gi)]
    const seenNames = new Set()

    for (const m of matches) {
      const methodType = m[1].toLowerCase()
      const paramName = m[2].toLowerCase().replace(/[^a-z0-9_-]/g, '_').substring(0, 32)
      const isRequired = m[3] ? m[3].toLowerCase() === 'true' : false
      if (paramName && !seenNames.has(paramName)) {
        seenNames.add(paramName)
        let type = 'string'
        if (methodType === 'integer') type = 'integer'
        else if (methodType === 'number') type = 'number'
        else if (methodType === 'boolean') type = 'boolean'
        else if (methodType === 'user') type = 'user'
        else if (methodType === 'channel') type = 'channel'
        else if (methodType === 'role') type = 'role'

        rawList.push({
          name: paramName,
          description: `${paramName} option`,
          type,
          required: isRequired
        })
      }
    }
  }

  // Deduplicate and filter valid names
  const seen = new Set()
  const uniqueList = []
  for (const opt of rawList) {
    if (opt.name && !seen.has(opt.name)) {
      seen.add(opt.name)
      uniqueList.push(opt)
    }
  }

  // Discord invariant: All required options MUST precede optional options
  uniqueList.sort((a, b) => (b.required ? 1 : 0) - (a.required ? 1 : 0))

  // Discord limit: maximum 25 options
  const optionsList = uniqueList.slice(0, 25)

  let chains = ''
  for (const opt of optionsList) {
    if (opt.type === 'integer' || opt.type === 'int') {
      chains += `\n    .addIntegerOption(opt => opt.setName(${JSON.stringify(opt.name)}).setDescription(${JSON.stringify(opt.description)}).setRequired(${opt.required}))`
    } else if (opt.type === 'number') {
      chains += `\n    .addNumberOption(opt => opt.setName(${JSON.stringify(opt.name)}).setDescription(${JSON.stringify(opt.description)}).setRequired(${opt.required}))`
    } else if (opt.type === 'boolean' || opt.type === 'bool') {
      chains += `\n    .addBooleanOption(opt => opt.setName(${JSON.stringify(opt.name)}).setDescription(${JSON.stringify(opt.description)}).setRequired(${opt.required}))`
    } else if (opt.type === 'user') {
      chains += `\n    .addUserOption(opt => opt.setName(${JSON.stringify(opt.name)}).setDescription(${JSON.stringify(opt.description)}).setRequired(${opt.required}))`
    } else if (opt.type === 'channel') {
      chains += `\n    .addChannelOption(opt => opt.setName(${JSON.stringify(opt.name)}).setDescription(${JSON.stringify(opt.description)}).setRequired(${opt.required}))`
    } else if (opt.type === 'role') {
      chains += `\n    .addRoleOption(opt => opt.setName(${JSON.stringify(opt.name)}).setDescription(${JSON.stringify(opt.description)}).setRequired(${opt.required}))`
    } else {
      chains += `\n    .addStringOption(opt => opt.setName(${JSON.stringify(opt.name)}).setDescription(${JSON.stringify(opt.description)}).setRequired(${opt.required}))`
    }
  }

  return chains
}

/**
 * Creates and deploys a new Discord application slash command.
 * @param {object} options
 * @param {string} options.name - 1-32 lowercase alphanumeric characters
 * @param {string} [options.description] - 1-100 characters description
 * @param {Array|object} [options.options] - Parameter options schema
 * @param {string} options.code - The execute function body or complete file module.exports
 * @param {import('discord.js').Client} [options.bot]
 * @param {string} [options.guildId] - Specific guild ID for guild-scoped commands
 * @param {boolean} [options.isGlobal] - Set true for global command (creator-only)
 * @param {string} [options.userId] - ID of user creating the command
 * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
 */
async function createSlashCommand ({ name, description, options, code, bot, guildId, isGlobal = false, userId }) {
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

  const isOwner = userId === process.env.OWNER_ID
  // Determine effective target guild:
  // If isOwner and isGlobal is true (or in DMs with no guildId), deploy globally. Otherwise guild-scoped.
  const targetGuildId = (isOwner && isGlobal) || (!guildId && isOwner) ? null : guildId

  let fileContent = code.trim()
  // Strip markdown code fences if model wrapped the code in ```javascript ... ```
  if (fileContent.startsWith('```')) {
    fileContent = fileContent.replace(/^```(?:javascript|js)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
  }

  // Security pattern scan (block filesystem destruction and process exit/spawning)
  const forbiddenPatterns = [
    /require\s*\(\s*['"`]fs['"`]\s*\)/,
    /require\s*\(\s*['"`]child_process['"`]\s*\)/,
    /require\s*\(\s*['"`]os['"`]\s*\)/,
    /require\s*\(\s*['"`]net['"`]\s*\)/,
    /process\s*\.\s*(exit|kill|binding)/,
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /\.exec\s*\(/,
    /\.spawn\s*\(/,
    /\.execSync\s*\(/
  ]
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(fileContent)) {
      const hit = fileContent.match(pattern)?.[0]
      logger.warn(`commandManager: Rejected new slash command "/${cleanName}" — forbidden pattern: "${hit}"`)
      return { success: false, error: `Forbidden operation detected: "${hit}". Only safe Discord.js and network APIs are allowed.` }
    }
  }

  // If code is just a function body, wrap it in a standard SlashCommand module with options and guildId
  if (!fileContent.includes('SlashCommandBuilder') && !fileContent.includes('module.exports')) {
    const desc = (description || `Execute ${cleanName}`).substring(0, 100)
    const optionsChains = buildOptionsChains(options, fileContent)
    fileContent = `// Auto-generated slash command: ${cleanName}
// Created: ${new Date().toISOString()}

const { SlashCommandBuilder } = require('discord.js')

module.exports = {
  guildId: ${JSON.stringify(targetGuildId || null)},
  data: new SlashCommandBuilder()
    .setName(${JSON.stringify(cleanName)})
    .setDescription(${JSON.stringify(desc)})${optionsChains},
  execute: async (interaction) => {
${fileContent.split('\n').map(l => '    ' + l).join('\n')}
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

    const deployResult = await deploySlashCommands(targetGuildId || 'global')
    if (!deployResult.success) {
      return { success: false, error: `Command written to disk but Discord registration failed: ${deployResult.error}` }
    }

    const scopeLabel = targetGuildId ? `scoped to server ${targetGuildId}` : 'globally across all servers'
    logger.info(`commandManager: Successfully created and published new slash command "/${cleanName}" ${scopeLabel} to Discord.`)
    return { success: true, message: `Successfully created and deployed new slash command "/${cleanName}" ${scopeLabel} live on Discord!` }
  } catch (err) {
    logger.error(`commandManager: Failed to write and publish command "/${cleanName}": ${err.message}`)
    return { success: false, error: err.message }
  }
}

module.exports = {
  deploySlashCommands,
  listSlashCommands,
  inspectSlashCommand,
  disableSlashCommand,
  enableSlashCommand,
  createSlashCommand,
  PROTECTED_COMMANDS
}
