/**
 * Normalized interaction representation across all client surfaces (Discord, CLI, Web, etc.).
 * Standardizes reply methods and options parsing while preserving raw client object.
 */
class NormalizedInteraction {
  constructor ({
    clientId = 'generic',
    id = String(Date.now()),
    type = 'command', // 'command' | 'chat' | 'button' | 'select' | 'modal'
    customId = null,
    commandName = null,
    user = { id: 'anonymous', username: 'Anonymous' },
    guild = null,
    guildId = null,
    channel = { id: 'default', name: 'general' },
    channelId = 'default',
    client = null,
    options = {},
    raw = null,
    handlers = {}
  } = {}) {
    this.clientId = clientId
    this.id = id
    this.type = type
    this.customId = customId
    this.commandName = commandName
    this.user = user
    this.member = raw?.member || { user, displayName: user.displayName || user.username }
    this.guild = guild
    this.guildId = guildId || guild?.id || null
    this.channel = channel
    this.channelId = channelId || channel?.id || 'default'
    this.client = client || raw?.client || null
    this.raw = raw
    this.deferred = false
    this.replied = false

    this._optionsMap = new Map()
    if (typeof options === 'object' && options !== null) {
      for (const [k, v] of Object.entries(options)) {
        this._optionsMap.set(k.toLowerCase(), v)
      }
    }

    this.options = {
      getString: (name) => {
        const val = this._optionsMap.get(name?.toLowerCase())
        return val !== undefined ? String(val) : null
      },
      getInteger: (name) => {
        const val = this._optionsMap.get(name?.toLowerCase())
        const parsed = parseInt(val, 10)
        return !isNaN(parsed) ? parsed : null
      },
      getNumber: (name) => {
        const val = this._optionsMap.get(name?.toLowerCase())
        const parsed = parseFloat(val)
        return !isNaN(parsed) ? parsed : null
      },
      getBoolean: (name) => {
        const val = this._optionsMap.get(name?.toLowerCase())
        if (typeof val === 'boolean') return val
        if (typeof val === 'string') {
          if (val.toLowerCase() === 'true') return true
          if (val.toLowerCase() === 'false') return false
        }
        return null
      },
      getAttachment: (name) => {
        return this._optionsMap.get(name?.toLowerCase()) || null
      },
      get: (name) => {
        const val = this._optionsMap.get(name?.toLowerCase())
        return val !== undefined ? { value: val } : null
      }
    }

    this._handlers = handlers
  }

  async deferReply (opts = {}) {
    this.deferred = true
    if (typeof this._handlers.deferReply === 'function') {
      return await this._handlers.deferReply(opts)
    }
    if (this.raw && typeof this.raw.deferReply === 'function') {
      return await this.raw.deferReply(opts)
    }
  }

  async reply (payload) {
    this.replied = true
    if (typeof this._handlers.reply === 'function') {
      return await this._handlers.reply(payload)
    }
    if (this.raw && typeof this.raw.reply === 'function') {
      return await this.raw.reply(payload)
    }
  }

  async editReply (payload) {
    this.replied = true
    if (typeof this._handlers.editReply === 'function') {
      return await this._handlers.editReply(payload)
    }
    if (this.raw && typeof this.raw.editReply === 'function') {
      return await this.raw.editReply(payload)
    }
  }

  async showStatus (text) {
    if (typeof this._handlers.showStatus === 'function') {
      return await this._handlers.showStatus(text)
    }
    if (this.raw && typeof this.raw.showStatus === 'function') {
      return await this.raw.showStatus(text)
    }
    // Headless / CLI: no-op by default. Adapters can override via handlers.
  }

  resetStream () {
    if (typeof this._handlers.resetStream === 'function') {
      this._handlers.resetStream()
    }
    if (this.raw && typeof this.raw.resetStream === 'function') {
      this.raw.resetStream()
    }
    if (typeof this.streamToken?.reset === 'function') {
      this.streamToken.reset()
    }
  }

  async followUp (payload) {
    if (typeof this._handlers.followUp === 'function') {
      return await this._handlers.followUp(payload)
    }
    if (this.raw && typeof this.raw.followUp === 'function') {
      return await this.raw.followUp(payload)
    }
  }

  async deleteReply () {
    if (typeof this._handlers.deleteReply === 'function') {
      return await this._handlers.deleteReply()
    }
    if (this.raw && typeof this.raw.deleteReply === 'function') {
      return await this.raw.deleteReply()
    }
  }

  cleanup () {
    if (typeof this._handlers.cleanup === 'function') {
      this._handlers.cleanup()
    }
    if (this.raw && typeof this.raw.cleanup === 'function') {
      this.raw.cleanup()
    }
  }
}

module.exports = NormalizedInteraction
