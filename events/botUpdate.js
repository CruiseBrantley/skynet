const logger = require('../logger')
function botUpdate () {
  return (originalMessage, updatedMessage) => {
    try {
      if (originalMessage.author.bot) return // ignore bots
      if (originalMessage !== undefined) {
        const authorName = originalMessage.member?.displayName || originalMessage.author.username;
        logger.info(
          'User ' +
            authorName +
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
