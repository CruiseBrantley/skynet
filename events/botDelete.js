const logger = require('../logger')
function botDelete () {
  return message => {
    // if (message.author.bot) return; //ignore bots
    if (message !== undefined) {
      logger.info(
        `${message.author.username}'s message was deleted: "${message.content}"`
      )
    }
  }
}
module.exports = botDelete
