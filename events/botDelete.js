const logger = require('../logger')
function botDelete () {
  return message => {
    // if (message.author.bot) return; //ignore bots
    if (message) {
      const authorName = message.member?.displayName || message.author?.username || 'Unknown'
      const content = message.content || '[Uncached Content]'
      logger.info(
        `${authorName}'s message was deleted: "${content}"`
      )
    }
  }
}
module.exports = botDelete
