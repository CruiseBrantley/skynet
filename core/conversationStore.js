const fs = require('fs')
const path = require('path')
const logger = require('../logger')

const DATA_DIR = path.join(__dirname, '../data/conversations')

class ConversationStore {
  constructor () {
    this._ensureDir()
    this._cache = new Map()
  }

  _ensureDir () {
    try {
      if (typeof fs.existsSync === 'function' && !fs.existsSync(DATA_DIR)) {
        if (typeof fs.mkdirSync === 'function') {
          fs.mkdirSync(DATA_DIR, { recursive: true })
        }
      }
    } catch (_) {}
  }

  _getFilePath (profileId) {
    const safeId = String(profileId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(DATA_DIR, `${safeId}.json`)
  }

  /**
   * Loads conversation history from disk into memory cache with mtime invalidation.
   */
  _load (profileId) {
    const filePath = this._getFilePath(profileId)
    let fileMtime = 0
    try {
      if (fs.existsSync(filePath)) {
        fileMtime = fs.statSync(filePath).mtimeMs
      }
    } catch (_) {}

    const cached = this._cache.get(profileId)
    if (cached && cached.mtime >= fileMtime) {
      return cached.messages
    }

    if (fileMtime > 0) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          this._cache.set(profileId, { messages: parsed, mtime: fileMtime })
          return parsed
        }
      } catch (err) {
        logger.warn(`ConversationStore: Failed to read ${filePath}: ${err.message}`)
      }
    }

    const initial = []
    this._cache.set(profileId, { messages: initial, mtime: fileMtime })
    return initial
  }

  /**
   * Persists profile conversation history to disk.
   */
  _save (profileId) {
    const cached = this._cache.get(profileId)
    const list = Array.isArray(cached) ? cached : (cached?.messages || [])
    const filePath = this._getFilePath(profileId)
    try {
      this._ensureDir()
      fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf8')
      const mtime = fs.statSync(filePath).mtimeMs
      this._cache.set(profileId, { messages: list, mtime })
    } catch (err) {
      logger.error(`ConversationStore: Failed to write ${filePath}: ${err.message}`)
    }
  }

  /**
   * Resolves a canonical profile ID from userId or interaction source.
   */
  resolveProfileId (userId, isOwner = false) {
    const ownerId = process.env.OWNER_ID
    if (userId === ownerId || isOwner) {
      return 'sirian'
    }
    if (userId) {
      return `user_${userId}`
    }
    return 'guest_session'
  }

  /**
   * Returns recent messages formatted for Ollama context or UI display.
   * @param {string} profileId
   * @param {number} limit
   * @returns {Array<{ role: string, content: string, author: string, source: string, timestamp: number, discordId?: string }>}
   */
  getHistory (profileId, limit = 20) {
    const messages = this._load(profileId)
    if (!limit || limit <= 0) return [...messages]
    return messages.slice(-limit)
  }

  /**
   * Checks if content is an ephemeral thinking/status placeholder.
   */
  isStatusMessage (content) {
    if (!content || typeof content !== 'string') return false
    const trimmed = content.trim().replace(/^\*+|\*+$/g, '').trim()
    return /is thinking\.\.\./i.test(trimmed) ||
           /is autonomously executing/i.test(trimmed) ||
           /^[•✓✗]\s+/m.test(trimmed)
  }

  /**
   * Appends a message to the persistent store.
   */
  appendMessage (profileId, { role, content, author, source = 'local', timestamp = Date.now(), discordId = null }) {
    if (!content || typeof content !== 'string' || !content.trim()) return null

    // Never persist ephemeral status or thinking messages
    if (this.isStatusMessage(content)) {
      return null
    }

    const list = this._load(profileId)

    // Deduplicate or update if discordId already exists
    if (discordId) {
      const existing = list.find(m => m.discordId === discordId)
      if (existing) {
        if (existing.content !== content.trim() && !this.isStatusMessage(content)) {
          existing.content = content.trim()
          this._save(profileId)
        }
        return null
      }
    }

    const trimmedContent = content.trim()
    const now = timestamp || Date.now()

    // Deduplicate duplicate assistant or user messages with identical content within 3 minutes
    const duplicate = list.slice(-5).find(m =>
      m.role === (role || 'assistant') &&
      m.content === trimmedContent &&
      Math.abs((m.timestamp || 0) - now) < 180000
    )
    if (duplicate) {
      if (discordId && !duplicate.discordId) {
        duplicate.discordId = discordId
        this._save(profileId)
      }
      return null
    }

    const entry = {
      role: role || (author === 'User' ? 'user' : 'assistant'),
      content: trimmedContent,
      author: author || (role === 'user' ? 'User' : 'Skynet'),
      source: source || 'local',
      timestamp: now,
      ...(discordId ? { discordId } : {})
    }

    list.push(entry)

    // Cap local storage at 500 messages per thread to prevent unbounded file growth
    if (list.length > 500) {
      list.splice(0, list.length - 500)
    }

    this._save(profileId)
    return entry
  }

  /**
   * Returns the latest stored Discord message snowflake ID for incremental synchronization.
   */
  getLatestDiscordMessageId (profileId) {
    const list = this._load(profileId)
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].discordId) {
        return list[i].discordId
      }
    }
    return null
  }

  /**
   * Incremental catch-up sync from a Discord DM channel.
   * Only fetches messages newer than the latest stored snowflake ID.
   */
  async syncFromDiscord (profileId, channel, botUserId, limit = 20) {
    if (!channel || typeof channel.messages?.fetch !== 'function') return []

    try {
      const lastDiscordId = this.getLatestDiscordMessageId(profileId)
      const fetchOptions = { limit: limit || 20 }
      if (lastDiscordId) {
        fetchOptions.after = lastDiscordId
      }

      const fetched = await channel.messages.fetch(fetchOptions)
      if (!fetched || fetched.size === 0) return []

      const sorted = Array.from(fetched.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      const newEntries = []

      for (const msg of sorted) {
        // Skip mirrored Web Chat Turn cards to prevent duplicate loops
        if (msg.embeds?.some(e => e.title === '💬 Web Chat Turn') || (msg.content && msg.content.includes('Web Chat Turn'))) {
          continue
        }

        if (!msg.content || typeof msg.content !== 'string') continue
        const isBot = msg.author?.id === botUserId || msg.author?.bot
        const cleanContent = msg.content.replace(new RegExp(`<@!?${botUserId}>`, 'g'), '').trim()
        if (!cleanContent) continue

        const entry = this.appendMessage(profileId, {
          role: isBot ? 'assistant' : 'user',
          content: cleanContent,
          author: isBot ? 'Skynet' : (msg.author.username || 'User'),
          source: 'discord',
          timestamp: msg.createdTimestamp,
          discordId: msg.id
        })

        if (entry) newEntries.push(entry)
      }

      if (newEntries.length > 0) {
        logger.info(`ConversationStore: Synced ${newEntries.length} new messages from Discord for profile "${profileId}".`)
      }
      return newEntries
    } catch (err) {
      logger.warn(`ConversationStore: Discord sync warning for profile "${profileId}": ${err.message}`)
      return []
    }
  }

  /**
   * Clears conversation history for a profile.
   */
  clearHistory (profileId) {
    this._cache.set(profileId, [])
    this._save(profileId)
  }
}

module.exports = new ConversationStore()
