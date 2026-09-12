const logger = require('../../logger')

module.exports = {
  name: 'restart_bot',
  description: 'Owner-Only: Gracefully terminates and restarts the Skynet bot service. The supervisor (macOS LaunchAgent / systemd) will respawn the process in 1-2 seconds with all new code/configuration loaded.',
  ownerOnly: true,
  privateOnly: true,
  schema: {
    reason: {
      type: 'string',
      description: 'Optional reason or note regarding why the restart was initiated.'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const reason = params.reason || 'Requested by owner'
    const initiator = context.username || context.authorName || 'Owner'

    logger.info(`restart_bot: Graceful restart initiated by ${initiator}. Reason: ${reason}`)

    const client = bot?.client || bot

    // In automated testing environments, do not exit the process
    if (process.env.NODE_ENV !== 'test') {
      setTimeout(async () => {
        try {
          if (client?.destroy && typeof client.destroy === 'function') {
            await client.destroy()
          }
        } catch (err) {
          logger.warn(`restart_bot: Error destroying Discord client: ${err.message}`)
        } finally {
          process.exit(0)
        }
      }, 750)
    }

    return {
      success: true,
      message: `Restart initiated successfully. Reason: "${reason}". Process will reboot and reload in ~2 seconds.`
    }
  }
}
