const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection
} = require('discord.js')
const IClientAdapter = require('../interfaces/IClientAdapter')
const NormalizedInteraction = require('../interfaces/NormalizedInteraction')
const logger = require('../logger')
const { formatForEmbed } = require('../util/discordFormatter')

class DiscordAdapter extends IClientAdapter {
  constructor ({ token = process.env.TOKEN, clientId = process.env.CLIENT_ID } = {}) {
    super({
      id: 'discord',
      name: 'Discord Gateway Client',
      capabilities: [
        'text',
        'markdown',
        'embeds',
        'reactions',
        'buttons',
        'select_menus',
        'modals',
        'voice',
        'slash_commands',
        'threads',
        'proactive_broadcast'
      ]
    })

    this.token = token || process.env.TOKEN
    this.clientId = clientId || process.env.CLIENT_ID

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

    this.client.commands = new Collection()
    this.pendingDMs = new Set()
  }

  async start (core) {
    await super.start(core)

    // Sync slash commands from core into client.commands collection
    for (const [name, cmd] of core.commands.entries()) {
      this.client.commands.set(name, cmd)
    }

    // Attach Discord event listeners
    this._attachEventListeners()

    if (this.token) {
      await this.client.login(this.token)
      logger.info('DiscordAdapter: Logged into Discord Gateway.')
    } else {
      logger.warn('DiscordAdapter: No TOKEN found in environment — client initialized in headless mode.')
    }
  }

  async stop () {
    if (this.client) {
      await this.client.destroy().catch(() => {})
      logger.info('DiscordAdapter: Disconnected from Discord Gateway.')
    }
    await super.stop()
  }

  _attachEventListeners () {
    // 1. Proactive DM Channel Caching Fix
    this.client.on('raw', async (packet) => {
      if (packet.t === 'MESSAGE_CREATE' && !packet.d.guild_id) {
        const msgId = packet.d.id
        const channelId = packet.d.channel_id
        this.pendingDMs.add(msgId)

        try {
          if (packet.d.author) await this.client.users.fetch(packet.d.author.id).catch(() => {})
          const channel = await this.client.channels.fetch(channelId).catch(() => null)

          setTimeout(async () => {
            if (this.pendingDMs.has(msgId)) {
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

    // 2. Interaction Handling (Slash Commands, Buttons, Select Menus, Modals)
    this.client.on('interactionCreate', async (rawInteraction) => {
      try {
        const optionsObj = {}
        if (rawInteraction.options && typeof rawInteraction.options.data === 'object') {
          for (const opt of rawInteraction.options.data) {
            optionsObj[opt.name] = opt.value
          }
        }

        const normalized = new NormalizedInteraction({
          clientId: 'discord',
          id: rawInteraction.id,
          type: rawInteraction.isChatInputCommand?.() ? 'command' : (rawInteraction.isButton?.() ? 'button' : 'other'),
          customId: rawInteraction.customId || null,
          commandName: rawInteraction.commandName || null,
          user: rawInteraction.user,
          guild: rawInteraction.guild,
          guildId: rawInteraction.guildId,
          channel: rawInteraction.channel,
          channelId: rawInteraction.channelId,
          client: this.client,
          options: optionsObj,
          raw: rawInteraction
        })

        if (this.core) {
          await this.core.dispatchInteraction(normalized)
        }
      } catch (err) {
        logger.error(`DiscordAdapter interactionCreate error: ${err.stack || err.message}`)
      }
    })
  }

  async sendMessage (channelId, payload) {
    if (!channelId || channelId === 'broadcast') {
      logger.info('DiscordAdapter: Broadcaster requested across all text channels.')
      return
    }

    const channel = await this.client.channels.fetch(channelId).catch(() => null)
    if (!channel || !channel.isTextBased()) {
      throw new Error(`DiscordAdapter: Channel ${channelId} not found or not text-based.`)
    }

    if (typeof payload === 'string') {
      return await channel.send(formatForEmbed(payload, 2000))
    }
    return await channel.send(payload)
  }

  async addReaction (channelId, messageId, emoji) {
    const channel = await this.client.channels.fetch(channelId).catch(() => null)
    if (!channel || !channel.isTextBased()) return
    const msg = await channel.messages.fetch(messageId).catch(() => null)
    if (msg) await msg.react(emoji).catch(e => logger.warn(`Discord reaction error: ${e.message}`))
  }

  async getRecentHistory (channelId, limit = 20) {
    const channel = await this.client.channels.fetch(channelId).catch(() => null)
    if (!channel || !channel.isTextBased()) return []
    const fetched = await channel.messages.fetch({ limit }).catch(() => null)
    if (!fetched) return []

    return Array.from(fetched.values()).reverse().map(m => ({
      author: m.author?.username || 'Unknown',
      content: m.content || '',
      createdTimestamp: m.createdTimestamp || Date.now()
    }))
  }

  async getActiveSessions () {
    const sessions = []
    if (!this.client?.guilds?.cache) return sessions

    for (const guild of this.client.guilds.cache.values()) {
      const channels = await guild.channels.fetch().catch(() => null)
      if (channels) {
        for (const c of channels.values()) {
          if (c && c.isTextBased?.() && !c.isVoiceBased?.()) {
            sessions.push({
              id: c.id,
              name: c.name,
              guildId: guild.id,
              guildName: guild.name,
              isDM: false
            })
          }
        }
      }
    }
    return sessions
  }
}

module.exports = DiscordAdapter
