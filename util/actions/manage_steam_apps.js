const fs = require('fs')
const path = require('path')
const logger = require('../../logger')

const CONFIG_PATH = path.join(__dirname, '../../config/steam_apps.json')
const BACKUP_DIR = path.join(__dirname, '../../data/config_backups')

function loadConfig () {
  if (!fs.existsSync(CONFIG_PATH)) {
    return []
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
  return JSON.parse(raw)
}

function saveConfigWithBackup (apps) {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
  }

  // Create timestamped backup if source exists
  if (fs.existsSync(CONFIG_PATH)) {
    const backupFile = path.join(BACKUP_DIR, `steam_apps_${Date.now()}.bak.json`)
    fs.copyFileSync(CONFIG_PATH, backupFile)
    logger.info(`manage_steam_apps: Created backup snapshot at ${backupFile}`)
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(apps, null, 2), 'utf8')
}

module.exports = {
  name: 'manage_steam_apps',
  description: 'Reads, adds, updates, or removes dedicated game server definitions in config/steam_apps.json for the /server management command.',
  schema: {
    action: {
      type: 'string',
      description: 'Action to perform: "read", "add", "update", or "remove".'
    },
    key: {
      type: 'string',
      description: 'The unique server key identifier (e.g. "icarus", "zomboid", "valheim"). Required for update and remove.'
    },
    data: {
      type: 'object',
      description: 'Configuration object for add or update. Allowed fields: name, key, appId, installDir, processName, executable, guildId, queryPort, logCommand.'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const action = (params.action || 'read').toLowerCase().trim()
    const targetKey = (params.key || params.data?.key || '').toLowerCase().trim()

    let apps = []
    try {
      apps = loadConfig()
    } catch (err) {
      return `[SYSTEM: Error loading steam_apps.json: ${err.message}]`
    }

    if (action === 'read') {
      if (targetKey) {
        const found = apps.find(a => (a.key || '').toLowerCase() === targetKey)
        if (!found) {
          return `[SYSTEM: Game server with key "${targetKey}" was not found in steam_apps.json. Existing keys: ${apps.map(a => a.key).join(', ') || 'none'}]`
        }
        return `[SYSTEM: Server definition for "${targetKey}":\n\`\`\`json\n${JSON.stringify(found, null, 2)}\n\`\`\`]`
      }

      return `[SYSTEM: Loaded ${apps.length} game servers from steam_apps.json:\n\`\`\`json\n${JSON.stringify(apps, null, 2)}\n\`\`\`]`
    }

    if (action === 'add') {
      const data = params.data || {}
      const key = (data.key || targetKey).toLowerCase().trim()
      if (!key) return '[SYSTEM: Error: "key" is required when adding a new game server.]'
      if (!data.name) return '[SYSTEM: Error: "name" is required when adding a new game server.]'

      if (apps.some(a => (a.key || '').toLowerCase() === key)) {
        return `[SYSTEM: Error: Server key "${key}" already exists. Use action "update" to modify it.]`
      }

      const newEntry = {
        name: data.name,
        key,
        appId: String(data.appId || ''),
        installDir: data.installDir || '',
        processName: data.processName || '',
        executable: data.executable || '',
        guildId: data.guildId || '111277280432508928',
        queryPort: parseInt(data.queryPort) || 27015,
        logCommand: data.logCommand || ''
      }

      apps.push(newEntry)
      try {
        saveConfigWithBackup(apps)
        return `[SYSTEM: Successfully added game server "${newEntry.name}" (${key}) to steam_apps.json. /server command is immediately ready to manage it.]`
      } catch (err) {
        return `[SYSTEM: Failed to save steam_apps.json: ${err.message}]`
      }
    }

    if (action === 'update') {
      if (!targetKey) return '[SYSTEM: Error: "key" is required to identify which server to update.]'
      const index = apps.findIndex(a => (a.key || '').toLowerCase() === targetKey)
      if (index === -1) {
        return `[SYSTEM: Error: Game server with key "${targetKey}" not found. Existing keys: ${apps.map(a => a.key).join(', ') || 'none'}]`
      }

      const data = params.data || {}
      const existing = apps[index]

      // Update provided fields
      if (data.name !== undefined) existing.name = data.name
      if (data.appId !== undefined) existing.appId = String(data.appId)
      if (data.installDir !== undefined) existing.installDir = data.installDir
      if (data.processName !== undefined) existing.processName = data.processName
      if (data.executable !== undefined) existing.executable = data.executable
      if (data.guildId !== undefined) existing.guildId = data.guildId
      if (data.queryPort !== undefined) existing.queryPort = parseInt(data.queryPort) || existing.queryPort
      if (data.logCommand !== undefined) existing.logCommand = data.logCommand

      apps[index] = existing
      try {
        saveConfigWithBackup(apps)
        return `[SYSTEM: Successfully updated game server "${existing.name}" (${targetKey}) in steam_apps.json:\n\`\`\`json\n${JSON.stringify(existing, null, 2)}\n\`\`\`]`
      } catch (err) {
        return `[SYSTEM: Failed to save steam_apps.json: ${err.message}]`
      }
    }

    if (action === 'remove') {
      if (!targetKey) return '[SYSTEM: Error: "key" is required to remove a game server.]'
      const index = apps.findIndex(a => (a.key || '').toLowerCase() === targetKey)
      if (index === -1) {
        return `[SYSTEM: Error: Game server with key "${targetKey}" not found in steam_apps.json.]`
      }

      const removed = apps.splice(index, 1)[0]
      try {
        saveConfigWithBackup(apps)
        return `[SYSTEM: Successfully removed game server "${removed.name}" (${targetKey}) from steam_apps.json.]`
      } catch (err) {
        return `[SYSTEM: Failed to save steam_apps.json: ${err.message}]`
      }
    }

    return `[SYSTEM: Unknown manage_steam_apps action: "${action}". Expected "read", "add", "update", or "remove".]`
  }
}
