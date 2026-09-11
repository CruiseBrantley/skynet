const fs = require('fs')
const path = require('path')
const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  ChannelType
} = require('discord.js')
const logger = require('../../logger')
const { handleVoiceStateUpdate } = require('./voice')
const { handleInteractionComponent } = require('./interactions')
const { addReaction, removeReaction } = require('./reactions')
const { formatForEmbed } = require('../../util/discordFormatter')
const { fetchAndFormatContext } = require('./contextHelper')
const mentionResolver = require('../../util/MentionResolver')
const botDelete = require('../../events/botDelete')
const botUpdate = require('../../events/botUpdate')
const linkSummarize = require('../../events/linkSummarize')

class DiscordAdapter {
  constructor ({ token = process.env.TOKEN, core } = {}) {
    this.id = 'discord'
    this.name = 'Discord Gateway Client'
    this.token = token || process.env.TOKEN
    this.core = core || null
    this.commands = new Collection()
    this.pendingDMs = new Set()
    this.processedMessages = new Set()

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
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

    this.client.commands = this.commands
  }

  get guilds () { return this.client?.guilds }
  get user () { return this.client?.user }
  get channels () { return this.client?.channels }
  get users () { return this.client?.users }

  async start (core) {
    if (core) this.core = core
    this._loadCommands()
    this._attachEventListeners()

    if (this.token) {
      await this.client.login(this.token)
    } else {
      logger.warn('DiscordAdapter: No TOKEN found in environment — running in mock/headless mode.')
    }
  }

  _loadCommands () {
    this.commands.clear()
    const commandsPath = path.join(__dirname, '../../commands')
    if (!fs.existsSync(commandsPath)) return

    const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js') && f !== 'chat.js')
    for (const file of commandFiles) {
      try {
        const filePath = path.join(commandsPath, file)
        const command = require(filePath)
        if ('data' in command && 'execute' in command) {
          this.commands.set(command.data.name, command)
        }
      } catch (err) {
        logger.warn(`DiscordAdapter: Failed to load command ${file}: ${err.message}`)
      }
    }
    logger.info(`DiscordAdapter: Loaded ${this.commands.size} slash commands.`)
  }

  _attachEventListeners () {
    // 0. Attach linkSummarize once to client
    try {
      linkSummarize(this.client)
    } catch (e) {
      logger.warn(`Failed to initialize linkSummarize: ${e.message}`)
    }

    // 1. Proactive DM Channel Caching Fix for Discord.js v14 (CRITICAL GUARDRAIL)
    this.client.on('raw', async (packet) => {
      if (packet.t === 'MESSAGE_CREATE' && !packet.d.guild_id) {
        const msgId = packet.d.id
        const channelId = packet.d.channel_id
        this.pendingDMs.add(msgId)

        try {
          if (packet.d.author) await this.client.users.fetch(packet.d.author.id).catch(() => {})
          const channel = await this.client.channels.fetch(channelId).catch(() => null)

          setTimeout(async () => {
            if (this.pendingDMs.has(msgId) && !this.processedMessages.has(msgId)) {
              logger.info(`[DM-FIX] Manually triggering event for message ${msgId}`)
              if (channel) {
                const message = await channel.messages.fetch(msgId).catch(() => null)
                if (message) this.client.emit('messageCreate', message)
              }
              this.pendingDMs.delete(msgId)
            }
          }, 1500)
        } catch (e) {
          logger.error(`DM raw handler error: ${e.message}`)
        }
      }
    })

    // 2. Client Ready
    this.client.on('clientReady', async () => {
      logger.info('Connected')
      logger.info('Logged in as: ')
      logger.info(this.client.user.username + ' - (' + this.client.user.id + ')')
      this.client.user.setActivity(process.env.BOT_ACTIVITY || 'for you', { type: 'WATCHING' })

      // Auto-hydrate creator (owner) DM history into local conversationStore on startup
      if (process.env.OWNER_ID) {
        try {
          const ownerUser = await this.client.users.fetch(process.env.OWNER_ID).catch(() => null)
          if (ownerUser) {
            const dmChannel = ownerUser.dmChannel || await ownerUser.createDM().catch(() => null)
            if (dmChannel) {
              const conversationStore = require('../../core/conversationStore')
              const synced = await conversationStore.syncFromDiscord('sirian', dmChannel, this.client.user.id, 50)
              logger.info(`DiscordAdapter: Hydrated ${synced.length} messages from owner DM into conversationStore.`)
            }
          }
        } catch (e) {
          logger.warn(`DiscordAdapter: Owner DM hydration warning: ${e.message}`)
        }
      }
    })

    // 3. Voice State Updates
    this.client.on('voiceStateUpdate', handleVoiceStateUpdate)

    // 4. Message Reaction Add / Remove
    this.client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot) return
      const emojiKey = reaction.emoji.id ? `${reaction.emoji.name}:${reaction.emoji.id}` : reaction.emoji.name
      addReaction(reaction.message.id, emojiKey, user.username)
    })

    this.client.on('messageReactionRemove', async (reaction, user) => {
      if (user.bot) return
      const emojiKey = reaction.emoji.id ? `${reaction.emoji.name}:${reaction.emoji.id}` : reaction.emoji.name
      removeReaction(reaction.message.id, emojiKey, user.username)
    })

    // 5. Interaction Routing (Slash Commands & Dynamic Components)
    this.client.on('interactionCreate', async (interaction) => {
      try {
        const handledComponent = await handleInteractionComponent(interaction, this.core)
        if (handledComponent) return

        if (interaction.isChatInputCommand?.()) {
          const command = this.commands.get(interaction.commandName)
          if (!command) {
            return await interaction.reply({ content: `Command /${interaction.commandName} not found.`, ephemeral: true })
          }

          await command.execute(interaction, this.core?.database)
        }
      } catch (err) {
        logger.error(`DiscordAdapter interactionCreate error: ${err.stack || err.message}`)
      }
    })

    // 6. Message Update & Delete Hooks
    this.client.on('messageUpdate', (oldMsg, newMsg) => {
      try {
        botUpdate(this.client, oldMsg, newMsg, this.core?.database)
      } catch (e) {}
    })
    this.client.on('messageDelete', (msg) => {
      try {
        botDelete(this.client, msg, this.core?.database)
      } catch (e) {}
    })

    // 7. Message Create Event (Mentions, DMs, Summaries)
    this.client.on('messageCreate', async (message) => {
      try {
        if (!message || !message.author) return
        if (message.author.bot) return

        // 1. Cancel fallback DM emission if message arrived naturally
        this.pendingDMs.delete(message.id)

        // 2. Strict deduplication (prevent double execution from fallback races)
        if (this.processedMessages.has(message.id)) {
          return
        }
        this.processedMessages.add(message.id)
        if (this.processedMessages.size > 1000) {
          const first = this.processedMessages.values().next().value
          this.processedMessages.delete(first)
        }

        mentionResolver.record(message.author.username, message.author.id, message.guildId)
        if (message.member?.nickname) mentionResolver.record(message.member.nickname, message.author.id, message.guildId)

        const isDM = message.channel.type === ChannelType.DM || !message.guildId
        const isDirectMention = Boolean(
          (this.client.user?.id && message.mentions?.has?.(this.client.user.id, { ignoreEveryone: true, ignoreRoles: true })) ||
          (this.client.user?.id && (message.content?.includes(`<@${this.client.user.id}>`) || message.content?.includes(`<@!${this.client.user.id}>`)))
        )
        const isReplyToBot = Boolean(
          message.reference &&
          message.mentions?.repliedUser?.id === this.client.user?.id
        )
        const isMentioned = isDirectMention || isReplyToBot

        if (isDM || isMentioned) {
          logger.info(`DiscordAdapter: Handling ${isDM ? 'DM' : 'mention'} from @${message.author.username} in #${message.channel?.name || 'DM'}`)
          const chatCommand = require('../../commands/chat')
          if (chatCommand && typeof chatCommand.execute === 'function') {
            let typingInterval = null
            const stopTyping = () => {
              if (typingInterval) {
                clearInterval(typingInterval)
                typingInterval = null
              }
            }

            const startTyping = () => {
              stopTyping()
              message.channel.sendTyping().catch(() => {})
              typingInterval = setInterval(() => {
                message.channel.sendTyping().catch(() => {})
              }, 4000)
              if (typingInterval.unref) typingInterval.unref()
            }

            startTyping()
            let responseMessage = null
            let heartbeat = null
            const clearStatusInterval = () => {
              if (heartbeat) {
                heartbeat.stop()
                heartbeat = null
              }
            }

            const cleanup = () => {
              stopTyping()
              clearStatusInterval()
            }

            const replyFunc = async (content) => {
              cleanup()
              const payload = typeof content === 'string' ? { content } : content
              responseMessage = await message.channel.send(payload)
              return responseMessage
            }
            const editFunc = async (content) => {
              const payload = typeof content === 'string' ? { content } : content
              if (responseMessage) {
                return await responseMessage.edit(payload)
              } else {
                responseMessage = await message.channel.send(payload)
                return responseMessage
              }
            }

            let cleanContent = (message.content || '').replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '').trim()
            if (!cleanContent && !message.attachments?.size) {
              cleanContent = 'Hello!'
            }
            const preFetchedHistory = await fetchAndFormatContext(message.channel, this.client.user.id, 20, message.id)

            let buffer = ''
            let lastEdit = 0
            let isEditing = false
            let hasEdited = false
            let gen = 0
            const BATCH_MS = 800 // 800ms throttle to stay comfortably within Discord rate limits
            const MAX_LEN = 1900 // safe threshold under Discord 2000 char limit

            const resetStream = () => {
              buffer = ''
              isEditing = false
              hasEdited = false
              lastEdit = 0
              gen++
            }

            const streamToken = async (token) => {
              const myGen = gen
              if (myGen !== gen) return
              buffer += token
              const now = Date.now()
              if (now - lastEdit < BATCH_MS || isEditing) return

              lastEdit = now
              isEditing = true

              try {
                if (myGen !== gen) return
                const visibleText = buffer
                  .replace(/<think[\s\S]*?(?:<\/think>|$)/gi, '')
                  .replace(/<thought[\s\S]*?(?:<\/thought>|$)/gi, '')
                  .replace(/<action[\s\S]*?(?:<\/action>|$)/gi, '')
                  .replace(/<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd][\s\S]*?(?:>>>|$)/gi, '')
                  .replace(/<<<[\s\S]*?(?:>>>|$)/gi, '')
                  .replace(/<[a-zA-Z0-9_]*$/g, '')
                  .replace(/<<*$/g, '')
                  .trim()

                if (!visibleText) return

                clearStatusInterval()
                const toPost = visibleText.length > MAX_LEN
                  ? visibleText.substring(0, MAX_LEN)
                  : visibleText

                const res = await editFunc({ content: toPost, flags: [4096] }).catch((err) => {
                  if (err.code === 10008 || err.status === 404) {
                    responseMessage = null
                  }
                  return null
                })
                if (res) hasEdited = true
              } finally {
                isEditing = false
              }
            }
            streamToken.reset = resetStream
            streamToken.hasEdited = () => hasEdited

            const showStatusFunc = async (text) => {
              clearStatusInterval()
              startTyping()

              const { createStatusHeartbeat } = require('../../util/chat/statusHeartbeat')
              const updateStatus = async (payload) => {
                if (responseMessage) {
                  return await responseMessage.edit(payload)
                } else {
                  responseMessage = await message.channel.send(payload)
                  return responseMessage
                }
              }

              heartbeat = createStatusHeartbeat(updateStatus, text)
              await heartbeat.start()
              return responseMessage
            }

            const normalizedInteraction = {
              id: message.id,
              triggeringMessageId: message.id,
              channelId: message.channel.id,
              channel: message.channel,
              guildId: message.guildId,
              guild: message.guild,
              user: message.author,
              member: message.member,
              client: this.client,
              options: {
                getString: (opt) => opt === 'message' ? cleanContent : null,
                getAttachment: () => message.attachments?.first?.() || null,
                attachments: message.attachments
              },
              deferred: true,
              replied: false,
              deferReply: async () => {},
              deleteReply: async () => {
                cleanup()
                resetStream()
                if (responseMessage) {
                  await responseMessage.delete().catch(() => {})
                  responseMessage = null
                }
              },
              fetchReply: async () => responseMessage,
              reply: replyFunc,
              editReply: editFunc,
              showStatus: showStatusFunc,
              followUp: async (content) => {
                cleanup()
                const payload = typeof content === 'string' ? { content } : content
                return await message.channel.send(payload)
              },
              streamToken,
              resetStream,
              cleanup,
              recentMessages: preFetchedHistory
            }

            // Immediately show thinking status so the user gets instant visual confirmation
            await showStatusFunc(`${this.client.user?.username || 'Skynet'} is thinking...`).catch(() => {})

            try {
              await chatCommand.execute(normalizedInteraction, this.core?.database)
            } catch (err) {
              logger.error(`Discord mention error: ${err.stack || err.message}`)
              message.channel.send(`There was an error communicating with the ${process.env.BOT_NAME || 'Bot'} AI Core.`).catch(() => {})
            } finally {
              cleanup()
            }
          }
        }
      } catch (err) {
        logger.error(`DiscordAdapter messageCreate fatal error: ${err.stack || err.message}`)
      }
    })
  }

  async sendMessage (channelId, payload) {
    const channel = await this.client.channels.fetch(channelId).catch(() => null)
    if (!channel || !channel.isTextBased()) return null

    if (typeof payload === 'string') {
      return await channel.send(formatForEmbed(payload, 2000))
    }
    return await channel.send(payload)
  }

  async addReaction (channelId, messageId, emoji) {
    const channel = await this.client.channels.fetch(channelId).catch(() => null)
    if (!channel || !channel.isTextBased()) return
    const msg = await channel.messages.fetch(messageId).catch(() => null)
    if (msg) await msg.react(emoji).catch(() => {})
  }

  /**
   * Mirrors a completed web chat turn to a user's Discord DM as a unified card.
   * @param {string} targetUserId - Discord User ID
   * @param {string} userPrompt
   * @param {string} replyContent
   * @param {Array<object>} executedTools
   * @returns {Promise<string|null>} Discord message ID if sent successfully
   */
  async mirrorWebTurnToUser (targetUserId, userPrompt, replyContent, executedTools = []) {
    const discordUserId = targetUserId || process.env.OWNER_ID
    if (!discordUserId || !this.client?.users) return null

    try {
      const user = await this.client.users.fetch(discordUserId).catch(() => null)
      if (!user) return null

      const dmChannel = user.dmChannel || await user.createDM().catch(() => null)
      if (!dmChannel || typeof dmChannel.send !== 'function') return null

      const { EmbedBuilder } = require('discord.js')

      // Vibrant palette for visual differentiation between turns
      const EMBED_COLORS = [
        0x5865F2, // Blurple
        0x57F287, // Green
        0xFEE75C, // Yellow
        0xEB459E, // Fuchsia
        0xED4245, // Red
        0x00B0F4, // Sky Blue
        0x9B59B6, // Purple
        0xE67E22, // Orange
        0x1ABC9C, // Teal
        0xE91E63 // Pink
      ]
      const randomColor = EMBED_COLORS[Math.floor(Math.random() * EMBED_COLORS.length)]

      const embed = new EmbedBuilder()
        .setColor(randomColor)
        .setTitle('💬 Web Chat Turn')
        .setTimestamp()

      const truncatedPrompt = (userPrompt || '').length > 1000
        ? userPrompt.substring(0, 997) + '...'
        : (userPrompt || '*[No Prompt]*')

      embed.addFields({
        name: '👤 You (via Web)',
        value: truncatedPrompt
      })

      // If reply fits inside embed value (max 1024 chars), put in field
      if (replyContent && replyContent.length <= 1024) {
        embed.addFields({
          name: `🤖 ${this.client.user?.username || 'Skynet'}`,
          value: replyContent
        })
      } else if (replyContent) {
        // Embed description can hold up to 4096 characters
        if (replyContent.length <= 4000) {
          embed.setDescription(`**🤖 ${this.client.user?.username || 'Skynet'}:**\n\n${replyContent}`)
        } else {
          embed.setDescription(`**🤖 ${this.client.user?.username || 'Skynet'}:**\n\n${replyContent.substring(0, 3990)}... *(truncated)*`)
        }
      }

      if (Array.isArray(executedTools) && executedTools.length > 0) {
        const toolNames = executedTools.map(t => `\`${t.name}\``).join(', ')
        embed.setFooter({ text: `Tools Executed: ${toolNames}` })
      } else {
        embed.setFooter({ text: 'Origin: Local Web UI' })
      }

      const sentMessage = await dmChannel.send({ embeds: [embed] })
      return sentMessage?.id || null
    } catch (err) {
      logger.warn(`DiscordAdapter: mirrorWebTurnToOwner error: ${err.message}`)
      return null
    }
  }
}

/**
 * Initializes and starts the Discord Client Adapter.
 * @param {object} core - SkynetCore instance.
 * @returns {Promise<DiscordAdapter>}
 */
async function initDiscord (core) {
  const adapter = new DiscordAdapter({ core })
  if (core && typeof core.registerClient === 'function') {
    core.registerClient(adapter)
  } else {
    await adapter.start(core)
  }
  return adapter
}

module.exports = {
  DiscordAdapter,
  initDiscord
}
