const logger = require('../logger')
function botUpdate () {
  return (originalMessage, updatedMessage) => {
    try {
      if (originalMessage.author.bot) return // ignore bots
      if (originalMessage !== undefined) {
        logger.info(
          'User ' +
            originalMessage.author.username +
            ' updated: "' +
            originalMessage.content +
            '" to "' +
            updatedMessage.content +
            '"'
        )
      }
    } catch (err) {
      logger.info('botUpdate error: ', err)
    }
  }
}
module.exports = botUpdate
