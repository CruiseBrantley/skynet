const gifService = require('../chat/gifService')
const logger = require('../../logger')

module.exports = {
  name: 'send_gif',
  description: 'Searches for and sends a GIF matching a search query to the channel',
  schema: {
    search_query: 'string — the query or emotion to search for (e.g. "happy", "crying", "dance")'
  },
  execute: async (bot, channel, params) => {
    const guildId = channel.guildId || (channel.guild ? channel.guild.id : null) || null
    const query = params.search_query || params.query || 'happy'

    try {
      const gifUrl = await gifService.getGif(query, guildId)
      if (gifUrl) {
        await channel.send({ content: gifUrl })
      } else {
        logger.info(`send_gif action: GIF search returned null (possibly disabled for guild ${guildId}).`)
      }
    } catch (err) {
      logger.error(`send_gif action failed: ${err.message}`)
      throw err
    }
  }
}
