const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')
const logger = require('../logger')

const appConfigPath = path.join(__dirname, '../config/steam_apps.json')

let cachedStatus = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 15000 // 15 seconds cache

/**
 * Returns an array of process names for all configured game servers in steam_apps.json.
 * Dynamically re-reads steam_apps.json if modified or called.
 */
function getGameServerProcesses () {
  try {
    if (fs.existsSync(appConfigPath)) {
      const data = fs.readFileSync(appConfigPath, 'utf8')
      const apps = JSON.parse(data)
      if (Array.isArray(apps)) {
        const processNames = apps
          .map(app => app.processName)
          .filter(name => typeof name === 'string' && name.trim().length > 0)
        if (processNames.length > 0) return processNames
      }
    }
  } catch (err) {
    logger.warn(`gameServerDetector: Failed to read steam_apps.json: ${err.message}`)
  }
  return ['IcarusServer-Win64-Shipping.exe', 'java.exe']
}

/**
 * Runs a command on the remote game server host via SSH.
 */
function runSSH (command, host, key, timeout = 3000) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      'ssh',
      [
        '-i', key,
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ConnectTimeout=2',
        '-o', 'ServerAliveInterval=5',
        '-o', 'ServerAliveCountMax=1',
        host,
        command
      ],
      { timeout },
      (error, stdout, stderr) => {
        if (error) return reject(error)
        resolve(stdout || '')
      }
    )
  })
}

/**
 * Checks whether any configured dedicated game servers are currently running on the game server host.
 * Results are cached for 15 seconds to avoid SSH latency on rapid back-to-back LLM calls.
 *
 * @param {Object} [options]
 * @param {boolean} [options.forceRefresh=false]
 * @returns {Promise<boolean>} True if any game server is running or if check fails; false if idle.
 */
async function areGameServersActive (options = {}) {
  const forceRefresh = options.forceRefresh === true
  const now = Date.now()

  if (!forceRefresh && cachedStatus !== null && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedStatus
  }

  const sshHost = process.env.STEAM_SSH_HOST
  const sshKey = process.env.STEAM_SSH_KEY

  if (!sshHost || !sshKey) {
    return false
  }

  const processes = getGameServerProcesses()
  if (processes.length === 0) {
    cachedStatus = false
    cacheTimestamp = now
    return false
  }

  try {
    const tasklistOutput = await runSSH('tasklist /FO CSV', sshHost, sshKey, 3000)
    const lowerOutput = tasklistOutput.toLowerCase()

    const runningApp = processes.find(proc => lowerOutput.includes(proc.toLowerCase()))
    if (runningApp) {
      logger.info(`gameServerDetector: Dedicated game server process "${runningApp}" is active on ${sshHost}.`)
      cachedStatus = true
      cacheTimestamp = now
      return true
    }

    cachedStatus = false
    cacheTimestamp = now
    return false
  } catch (err) {
    logger.warn(`gameServerDetector: Could not inspect game server processes on ${sshHost}: ${err.message}`)
    // If SSH fails or times out, bypass secondary to avoid interfering with possible gaming/heavy network activity
    return true
  }
}

function clearCache () {
  cachedStatus = null
  cacheTimestamp = 0
}

module.exports = {
  areGameServersActive,
  getGameServerProcesses,
  clearCache
}
