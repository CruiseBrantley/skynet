const dotenv = require('dotenv')
dotenv.config()
const Discord = require('discord.js')
const logger = require('./logger')
const server = require('./server/server')

function discordBot () {
  // Initialize Discord Bot
  if (process.env.NODE_ENV !== 'dev') process.env.NODE_ENV = 'prod'
  console.log("Current ENV:", process.env.NODE_ENV)
  const bot = new Discord.Client()
  const aFunc = async () => {
    try {
      await bot.login(process.env.TOKEN)
      return bot
    } catch (err) {
      console.error('Bot Failed Logging in: ', err)
      process.exit()
    }
  }
  aFunc()

  bot.on('ready', () => {
    logger.info('Connected')
    logger.info('Logged in as: ')
    logger.info(bot.user.username + ' - (' + bot.user.id + ')')
    bot.user.setActivity('for John Connor', { type: 'WATCHING' })
  })

  bot.on('error', err => {
    logger.info('Encountered an error: ', err)
  })

  const botUpdate = require('./events/botUpdate')
  const botMessage = require('./events/botMessage')
  const botDelete = require('./events/botDelete')

  server(bot)

  // twitterChannelInit();

  bot.on('message', botMessage(bot))

  bot.on('messageUpdate', botUpdate())

  bot.on('messageDelete', botDelete())
}

discordBot()

module.exports = discordBot
