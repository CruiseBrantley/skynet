const musicManager = require('../../util/MusicManager')
const logger = require('../../logger')

const aloneTimers = new Map()

/**
 * Handles voiceStateUpdate events to auto-disconnect when the bot is left alone in a voice channel.
 */
function handleVoiceStateUpdate (oldState, newState) {
  const guildId = newState.guild.id
  const queue = musicManager.getQueue(guildId)

  if (!queue || !queue.connection) return

  const myChannelId = queue.connection.joinConfig.channelId
  const channel = newState.guild.channels.cache.get(myChannelId)

  if (!channel) return

  const humanCount = channel.members.filter((m) => !m.user.bot).size

  if (humanCount === 0) {
    if (!aloneTimers.has(guildId)) {
      logger.info(
        `Bot is alone in guild ${guildId}. Starting 60s auto-disconnect timer.`
      )
      const timer = setTimeout(() => {
        logger.info(
          `Auto-disconnecting from guild ${guildId} due to inactivity.`
        )
        musicManager.stop(guildId)
        aloneTimers.delete(guildId)
      }, 60000)
      aloneTimers.set(guildId, timer)
    }
  } else {
    if (aloneTimers.has(guildId)) {
      logger.info(
        `Humans returned to guild ${guildId}. Cancelling auto-disconnect timer.`
      )
      clearTimeout(aloneTimers.get(guildId))
      aloneTimers.delete(guildId)
    }
  }
}

module.exports = {
  musicManager,
  handleVoiceStateUpdate
}
