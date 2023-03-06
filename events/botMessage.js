const Command = require('../commands/Command')
const chatCommand = require('../commands/commandSwitch')
const chatgpt = require('../commands/chatgpt')
function botMessage (bot, database) {
  return message => {
    if (message.author.bot) return // ignore bots
    if (message.mentions.has(bot.user)) chatgpt.chat(message)
    if (message.content.substring(0, 1) !== '!') return // ignore non-commands

    // Listening for messages that will start with `!`
    let args = message.content.substring(1).split(/ +/g) // removes all spaces
    const cmd = args[0].toLowerCase()
    args = args.splice(1)
    const command = new Command(message, cmd, args, bot, database)
    chatCommand(command)
  }
}
module.exports = botMessage
