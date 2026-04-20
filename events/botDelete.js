const logger = require('../logger')
function botDelete () {
  return message => {
    // if (message.author.bot) return; //ignore bots
    if (message !== undefined) {
      const authorName = message.member?.displayName || message.author.username;
      logger.info(
        `${authorName}'s message was deleted: "${message.content}"`
      )
    }
  }
}
module.exports = botDelete
