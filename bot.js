/* eslint-disable no-unused-vars */
const fs = require('fs')
/* eslint-disable no-unused-vars */
const path = require('path')

const dotenv = require('dotenv')
dotenv.config()
const {
  Client,
  GatewayIntentBits,
  Collection,
  Partials,
  ChannelType
} = require('discord.js')
const logger = require('./logger')
const { setupServer: server } = require('./server/server')
const loginFirebase = require('./firebase-login')
const { exec } = require('child_process')

// Sync YouTube cookies from Safari on startup
exec('bash scripts/sync-youtube-cookies.sh', (err, stdout, stderr) => {
  if (err) {
    logger.error(`YouTube cookie sync failed: ${err.message}`)
  } else {
    logger.info('YouTube cookies synced successfully from Safari.')
  }
})

// Periodic/Startup Cleanup: Purge temp_music directory
const tempMusicDir = path.join(__dirname, 'temp_music')
if (fs.existsSync(tempMusicDir)) {
  const files = fs.readdirSync(tempMusicDir)
  for (const file of files) {
    try {
      fs.unlinkSync(path.join(tempMusicDir, file))
    } catch (err) {
      logger.warn(`Failed to cleanup orphaned file ${file}: ${err.message}`)
    }
  }
  logger.info(`Cleaned up ${files.length} orphaned music files on startup.`)
}

// Initialize Discord Bot
if (process.env.NODE_ENV !== 'dev') process.env.NODE_ENV = 'prod'
logger.info('Current ENV:' + process.env.NODE_ENV)

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.DirectMessageTyping
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.GuildMember,
    Partials.User,
    Partials.Reaction
  ]
})

// Proactive DM channel caching fix for Discord.js v14
const pendingDMs = new Set()

bot.on('raw', async (packet) => {
  if (packet.t === 'MESSAGE_CREATE' && !packet.d.guild_id) {
    const msgId = packet.d.id
    const channelId = packet.d.channel_id
    pendingDMs.add(msgId)

    try {
      if (packet.d.author) await bot.users.fetch(packet.d.author.id).catch(() => {})
      const channel = await bot.channels.fetch(channelId).catch(() => null)

      // Safety net: if Discord.js doesn't emit messageCreate in 1.5s, we do it manually.
      setTimeout(async () => {
        if (pendingDMs.has(msgId)) {
          logger.info(`[DM-FIX] Manually triggering event for message ${msgId}`)
          if (channel) {
            const message = await channel.messages.fetch(msgId).catch(() => null)
            if (message) bot.emit('messageCreate', message)
          }
          pendingDMs.delete(msgId)
        }
      }, 1500)
    } catch (e) {
      logger.error(`DM raw handler error: ${e.message}`)
    }
  }
})

bot.commands = new Collection()
const commandsPath = path.join(__dirname, 'commands')
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith('.js') && file !== 'chat.js')

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file)
  const command = require(filePath)
  if ('data' in command && 'execute' in command) {
    bot.commands.set(command.data.name, command)
  } else {
    console.log(
      `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
    )
  }
}

const database = loginFirebase()
const setupConfigSync = require('./util/configSync')
bot.configSync = setupConfigSync(database)

// Guardian setup for singleton detection
const InstanceGuardian = require('./util/InstanceGuardian')
const guardian = new InstanceGuardian(database)
guardian.init()

const musicManager = require('./util/MusicManager')
const agentScheduler = require('./util/AgentScheduler')
const agentLoop = require('./util/AgentLoop')
const botUpdate = require('./events/botUpdate')
const botDelete = require('./events/botDelete')
const { fetchAndFormatContext } = require('./util/chat/contextHelper')

const aloneTimers = new Map()

bot.on('debug', (info) => {
  if (info.includes('MESSAGE_CREATE')) {
    logger.info(`DEBUG: ${info}`)
  }
})

bot.on('ready', () => {
  logger.info('Connected')
  logger.info('Logged in as: ')
  logger.info(bot.user.username + ' - (' + bot.user.id + ')')
  bot.user.setActivity(process.env.BOT_ACTIVITY || 'for you', {
    type: 'WATCHING'
  })

  // Start the agent task scheduler tick (60-second interval)
  if (!bot._schedulerRunning) {
    bot._schedulerRunning = true
    logger.info('AgentScheduler: Tick started (60s interval).')
    setInterval(() => agentScheduler.processDueTasks(bot), 60_000)
  }

  // Start the background agent loop
  if (!bot._agentLoopStarted) {
    bot._agentLoopStarted = true
    const loopInterval =
      parseInt(process.env.AGENT_LOOP_INTERVAL_MS) || 5 * 60_000
    agentLoop.start(bot, loopInterval)
  }

  // Start the web server
  try {
    server(bot, database)
  } catch (err) {
    logger.error(`Failed to start web server: ${err.message}`)
  }
})

bot.on('error', (err) => {
  logger.error('Discord error: ' + err.message)
})

bot.on('voiceStateUpdate', (oldState, newState) => {
  const guildId = newState.guild.id
  const queue = musicManager.getQueue(guildId)

  if (!queue || !queue.connection) return

  const myChannelId = queue.connection.joinConfig.channelId
  const channel = newState.guild.channels.cache.get(myChannelId)

  if (!channel) return

  // Count non-bot members
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
})

bot.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    const command = interaction.client.commands.get(interaction.commandName)
    if (!command || !command.autocomplete) return
    try {
      await command.autocomplete(interaction)
    } catch (error) {
      logger.error(`Autocomplete error: ${error.message}`)
    }
  }

  if (interaction.isButton()) {
    // 1. Server Management Buttons
    if (interaction.customId.startsWith('server_')) {
      const command = interaction.client.commands.get('server')
      if (command && command.handleButton) {
        try {
          await command.handleButton(interaction)
        } catch (error) {
          logger.error(`Server button error: ${error.stack || error.message}`)
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Server interaction failed.', ephemeral: true }).catch(() => {})
          }
        }
      }
      return
    }

    // 2. Music Player Buttons (AIO Cinematic Interface)
    if (interaction.customId.startsWith('music_')) {
      try {
        await musicManager.handleInteraction(interaction)
      } catch (error) {
        logger.error(`Music button error: ${error.stack || error.message}`)
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Music interaction failed.', ephemeral: true }).catch(() => {})
        }
      }
      return
    }

    return
  }

  if (!interaction.isChatInputCommand()) return

  const command = interaction.client.commands.get(interaction.commandName)

  if (!command) {
    logger.warn(`No command matching ${interaction.commandName} was found.`)
    return
  }

  try {
    await command.execute(interaction, database)
  } catch (error) {
    logger.error(`Slash command error: ${error.stack || error.message}`)
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: 'There was an error while executing this command!',
        ephemeral: true
      })
    } else {
      await interaction.reply({
        content: 'There was an error while executing this command!',
        ephemeral: true
      })
    }
  }
})

bot.on('messageUpdate', botUpdate())
bot.on('messageDelete', botDelete())

bot.on('threadCreate', async (thread) => {
  try {
    // Auto-join if the thread was created from one of our messages
    const starter = await thread.fetchStarterMessage().catch(() => null)
    if (starter?.author.id === bot.user.id) {
      await thread.join()
      logger.info(
        `Auto-joined thread: ${thread.name} (Started from our message)`
      )
    }
  } catch (e) {
    logger.error(`Error auto-joining thread: ${e.message}`)
  }
})

bot.on('messageCreate', async (message) => {
  if (pendingDMs.has(message.id)) {
    pendingDMs.delete(message.id)
  }

  const contentPreview = message.content ? message.content.substring(0, 50) : '[Uncached Content]'
  logger.info(`Message received from ${message.author?.tag || 'unknown'}: "${contentPreview}"`)
  let preFetchedHistory = null
  try {
    if (message.partial) {
      logger.info(`BOT: Message ${message.id} is partial. Fetching...`)
      await Promise.race([
        message.fetch(),
        new Promise((resolve, reject) => setTimeout(() => reject(new Error('Message fetch timeout')), 5000))
      ]).catch(e => logger.warn(`BOT: Partial message fetch failed for ${message.id}: ${e.message}`))
    }

    if (message.channel?.partial) {
      logger.info(`BOT: Channel ${message.channelId} is partial. Fetching...`)
      await Promise.race([
        message.channel.fetch(),
        new Promise((resolve, reject) => setTimeout(() => reject(new Error('Channel fetch timeout')), 5000))
      ]).catch(e => logger.warn(`BOT: Partial channel fetch failed for ${message.channelId}: ${e.message}`))
    }

    if (!message.author) {
      logger.warn(`BOT: Message ${message.id} has no author after fetch. Skipping.`)
      return
    }

    const isDM = !message.guild || message.channel.type === ChannelType.DM || message.channel.type === ChannelType.GroupDM
    logger.info(`BOT: Message Analysis for ${message.id} — isDM=${isDM} guild=${message.guildId || 'DM'}`)

    if (message.author?.bot) return

    const isThread = message.channel?.isThread?.() || false

    // Skip messages sent more than 10 minutes ago
    const age = Date.now() - message.createdAt.getTime()
    if (age > 10 * 60 * 1000) {
      return
    }

    if (message.mentions.everyone) return

    const content = message.content || ''
    const isReplyToBot = message.type === 19 && message.mentions.repliedUser?.id === bot.user.id // 19 is MessageType.Reply
    const isMentioned = message.mentions.has(bot.user.id) || content.includes(`<@${bot.user.id}>`) || content.includes(`<@!${bot.user.id}>`)
    let shouldRespond = isMentioned || isReplyToBot || isDM

    if (shouldRespond) {
      logger.info(`BOT: shouldRespond=true for ${message.id} (isMentioned=${isMentioned}, isDM=${isDM})`)
    }

    if (!shouldRespond && isThread) {
      let isOurThread = false
      try {
        const threadMembers = await message.channel.members
          .fetch()
          .catch(() => new Collection())
        isOurThread =
          threadMembers.has(bot.user.id) ||
          message.channel.ownerId === bot.user.id

        if (!isOurThread) {
          // Secondary check: was this thread started from one of our messages?
          const starter = await message.channel
            .fetchStarterMessage()
            .catch(() => null)
          if (starter?.author.id === bot.user.id) {
            isOurThread = true
            await message.channel.join().catch(() => {})
          }
        }
      } catch (e) {
        logger.error(`Error checking thread membership: ${e.message}`)
      }

      if (isOurThread) {
        const botId = bot.user.id
        const history = await fetchAndFormatContext(message.channel, botId, 20, message.id)
        const context = history.map(m => m.content).join('\n')

        // Save history to the interaction so chat.js doesn't have to re-fetch
        preFetchedHistory = history

        const botName = process.env.BOT_NAME || 'Skynet'

        const containsName = message.content
          .toLowerCase()
          .includes(botName.toLowerCase())
        const isQuestion = message.content.includes('?')
        const lastWasBot = history[history.length - 1]?.author.id === bot.user.id

        if (containsName || (isQuestion && lastWasBot)) {
          shouldRespond = true
        } else {
          const { queryLocalOrRemote } = require('./util/ollama')
          const decision = await queryLocalOrRemote('/api/chat', {
            messages: [
              {
                role: 'system',
                content: `You are ${botName}. Decide if you should respond to the current thread. Respond only with YES or NO.`
              },
              {
                role: 'user',
                content: `[THREAD CONTEXT]\n${context}\n\nShould I respond?`
              }
            ],
            options: { temperature: 0, num_predict: 5 }
          }).catch(() => ({ message: { content: 'NO' } }))

          if (decision?.message?.content?.toUpperCase().includes('YES')) {
            shouldRespond = true
          }
        }
      }
    }

    if (shouldRespond) {
      logger.info(
        `Bot EXECUTING for ${message.author.tag} in ${isThread ? 'Thread' : isDM ? 'DM' : message.channelId}`
      )
      const chatCommand = require('./commands/chat.js')
      if (chatCommand) {
        let typingInterval
        let responseMessage = null
        const stopTyping = () => {
          if (typingInterval) clearInterval(typingInterval)
        }

        const replyFunc = async (content) => {
          stopTyping()
          const payload = typeof content === 'string' ? { content } : content
          // Use reply for autonomous messages to maintain the thread
          const sent = await message.reply(payload)
          if (!responseMessage) responseMessage = sent
          return sent
        }

        const editFunc = async (content) => {
          stopTyping()
          const payload = typeof content === 'string' ? { content } : content
          if (responseMessage) {
            return await responseMessage.edit(payload)
          } else {
            // Use reply for autonomous messages to maintain the thread
            const sent = await message.reply(payload)
            responseMessage = sent
            return sent
          }
        }

        const mockInteraction = {
          id: `autonomous-${Date.now()}`,
          triggeringMessageId: message.id,
          client: bot,
          user: message.author,
          member: message.member,
          guild: message.guild,
          guildId: message.guildId,
          channelId: message.channelId,
          channel: message.channel,
          options: {
            getString: (name) => (name === 'message' ? message.content : null),
            getAttachment: (name) =>
              message.attachments.size > 0 ? message.attachments.first() : null,
            attachments: message.attachments
          },
          deferReply: async () => {
            message.channel.sendTyping()
            typingInterval = setInterval(() => {
              message.channel.sendTyping()
            }, 9000)
          },
          deleteReply: async () => {
            stopTyping()
            if (responseMessage) {
              await responseMessage.delete().catch(() => {})
              responseMessage = null
            }
          },
          fetchReply: async () => responseMessage,
          reply: replyFunc,
          editReply: editFunc,
          followUp: replyFunc,
          recentMessages: preFetchedHistory
        }

        try {
          message.channel.sendTyping().catch(e => logger.warn(`Initial sendTyping failed: ${e.message}`))
          await chatCommand.execute(mockInteraction, database)
        } catch (err) {
          logger.error(`Mention error: ${err.stack || err.message}`)
          message.channel.send(
            `There was an error communicating with the ${process.env.BOT_NAME || 'Bot'} AI Core.`
          )
        } finally {
          stopTyping()
        }
      }
    }
  } catch (err) {
    logger.error(
      `Message handler fatal error for ${message.author?.tag || 'unknown'}: ${err.stack || err.message}`
    )
  }
})

bot.login(process.env.TOKEN).catch((err) => {
  logger.error('Bot Failed Logging in: ' + err.message)
  process.exit(1)
})

module.exports = bot
