const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')
dotenv.config()
const { exec } = require('child_process')
const logger = require('./logger')
const loginFirebase = require('./firebase-login')
const { initCore } = require('./core')
const { DiscordAdapter } = require('./adapters/discord')
const { setupServer } = require('./server/server')

// Startup housekeeping: sync YouTube cookies from Safari
exec('bash scripts/sync-youtube-cookies.sh', (err) => {
  if (err) logger.error(`YouTube cookie sync failed: ${err.message}`)
  else logger.info('YouTube cookies synced successfully from Safari.')
})

// Startup housekeeping: purge temp_music directory
const tempMusicDir = path.join(__dirname, 'temp_music')
if (fs.existsSync(tempMusicDir)) {
  const files = fs.readdirSync(tempMusicDir)
  for (const file of files) {
    try {
      fs.unlinkSync(path.join(tempMusicDir, file))
    } catch (err) {
      logger.warn(`Failed to cleanup orphaned file ${file}: ${err.message}`)
    }
  }
  logger.info(`Cleaned up ${files.length} orphaned music files on startup.`)
}

// 1. Initialize Firebase and Core
const database = loginFirebase()
const discordAdapter = new DiscordAdapter()

async function bootstrap () {
  const core = await initCore({ database, config: { isDaemon: true } })
  core.registerClient(discordAdapter)
  setupServer(core)
  return discordAdapter.client
}

bootstrap().catch((err) => {
  logger.error(`Skynet Bootstrap Failed: ${err.stack || err.message}`)
  process.exit(1)
})

module.exports = discordAdapter.client
