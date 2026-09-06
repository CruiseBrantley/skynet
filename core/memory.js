const fs = require('fs')
const path = require('path')
const logger = require('../logger')

const DATA_DIR = path.join(__dirname, '../data')
const MEMORY_FILE = path.join(DATA_DIR, 'agent_memory.json')

// Max entries before oldest non-permanent entries are pruned
const MAX_ENTRIES = 500

// Key prefixes that are always global (not tied to any guild)
const GLOBAL_PREFIXES = ['user.', 'preference.', 'global.']

/**
 * Determine the scope of a key based on its prefix.
 * Returns 'global' or 'server'.
 */
function scopeFor (key) {
  for (const prefix of GLOBAL_PREFIXES) {
    if (key.startsWith(prefix)) return 'global'
  }
  return 'server' // server.*, channel.*, behavior.*, or any unknown prefix
}

/**
 * Singleton long-term key/value memory store for the agent.
 * Persisted to local disk at data/agent_memory.json and synced to Firebase.
 * TTL-aware: entries expire after ttlDays. -1 = permanent.
 */
class AgentMemory {
  constructor () {
    this._database = null
    this._syncTimer = null
    this._ensureDataDir()
    this._data = this._load()
  }

  /**
   * Initializes Firebase cloud sync for long-term agent memories.
   */
  init (database) {
    this._database = database
    if (!this._database || typeof this._database.ref !== 'function') return

    try {
      const memRef = this._database.ref('agent_memory')
      memRef.once('value').then(snapshot => {
        if (snapshot && typeof snapshot.exists === 'function' && snapshot.exists()) {
          const remoteMem = snapshot.val()
          if (Array.isArray(remoteMem)) {
            for (const item of remoteMem) {
              if (item && item.key && !this._data[item.key]) {
                const { key, ...rest } = item
                this._data[key] = {
                  ...rest,
                  guildId: rest.guildId !== undefined ? rest.guildId : null
                }
              }
            }
            this._saveLocalOnly()
            logger.info(`AgentMemory: Hydrated ${remoteMem.length} memories from Firebase.`)
          } else if (remoteMem && typeof remoteMem === 'object') {
            for (const [k, v] of Object.entries(remoteMem)) {
              if (!this._data[k]) {
                this._data[k] = {
                  ...v,
                  guildId: v.guildId !== undefined ? v.guildId : null
                }
              }
            }
            this._saveLocalOnly()
            logger.info(`AgentMemory: Hydrated ${Object.keys(remoteMem).length} memories from Firebase.`)
          }
        } else if (Object.keys(this._data).length > 0) {
          this._syncRemote()
          logger.info('AgentMemory: Seeded Firebase with initial local memories.')
        }
      }).catch(err => {
        logger.warn(`AgentMemory: Firebase initial sync warning: ${err.message}`)
      })
    } catch (err) {
      logger.warn(`AgentMemory: Failed to setup Firebase sync: ${err.message}`)
    }
  }

  _syncRemote () {
    if (!this._database || typeof this._database.ref !== 'function') return
    if (this._syncTimer) clearTimeout(this._syncTimer)

    this._syncTimer = setTimeout(() => {
      try {
        const list = []
        for (const [k, v] of Object.entries(this._data)) {
          list.push({ key: k, ...v })
        }
        this._database.ref('agent_memory').set(list)
          .then(() => logger.debug('AgentMemory: Successfully synced memories to Firebase.'))
          .catch(e => logger.warn(`AgentMemory: Firebase sync error: ${e.message}`))
      } catch (err) {
        logger.warn(`AgentMemory: Failed to dispatch Firebase sync: ${err.message}`)
      }
    }, 500)
    if (this._syncTimer.unref) this._syncTimer.unref()
  }

  _ensureDataDir () {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      logger.info('AgentMemory: Created data/ directory for persistent storage.')
    }
  }

  _load () {
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'))
      }
    } catch (e) {
      logger.warn(`AgentMemory: Failed to load memory file, starting fresh: ${e.message}`)
    }
    return {}
  }

  _saveLocalOnly () {
    try {
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(this._data, null, 2))
    } catch (e) {
      logger.error(`AgentMemory: Failed to save memory: ${e.message}`)
    }
  }

  _save () {
    this._saveLocalOnly()
    this._syncRemote()
  }

  /**
   * Remove any entries whose TTL has expired.
   */
  _pruneExpired () {
    const now = Date.now()
    let pruned = 0
    for (const [key, entry] of Object.entries(this._data)) {
      if (entry.ttlDays > 0) {
        const expiresAt = entry.updatedAt + (entry.ttlDays * 86400 * 1000)
        if (now > expiresAt) {
          delete this._data[key]
          pruned++
        }
      }
    }
    if (pruned > 0) {
      logger.info(`AgentMemory: Pruned ${pruned} expired entries.`)
    }
  }

  /**
   * When we exceed MAX_ENTRIES, evict oldest non-permanent entries first.
   */
  _pruneOldest () {
    const entries = Object.entries(this._data)
    if (entries.length <= MAX_ENTRIES) return

    const evictable = entries
      .filter(([, e]) => e.ttlDays !== -1)
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt)

    const toRemove = entries.length - MAX_ENTRIES
    for (let i = 0; i < toRemove && i < evictable.length; i++) {
      delete this._data[evictable[i][0]]
    }
    logger.info(`AgentMemory: Evicted ${Math.min(toRemove, evictable.length)} oldest entries to stay under MAX_ENTRIES.`)
  }

  /**
   * Store a value under a key.
   */
  set (key, value, ttlDays = 30, guildId = null) {
    const scope = scopeFor(key)
    const entryGuildId = scope === 'global' ? null : (guildId || null)
    this._data[key] = {
      value: String(value),
      updatedAt: Date.now(),
      ttlDays,
      guildId: entryGuildId // null = global, string = server-specific
    }
    this._pruneExpired()
    this._pruneOldest()
    this._save()
    const scopeLabel = entryGuildId ? `guild:${entryGuildId}` : 'global'
    const ttlLabel = ttlDays === -1
      ? 'permanent'
      : ttlDays < 1
        ? `${Math.round(ttlDays * 24 * 60)}m`
        : `${+ttlDays.toFixed(4)} days`
    logger.info(`AgentMemory: Stored "${key}" [${scopeLabel}] (TTL: ${ttlLabel})`)

    return true
  }

  /**
   * Retrieve the value for a key, respecting scope.
   */
  get (key, guildId = null) {
    this._pruneExpired()
    const entry = this._data[key]
    if (!entry) return null
    if (entry.guildId !== null && entry.guildId !== guildId) return null
    return entry.value
  }

  /**
   * Delete a key from memory.
   */
  delete (key) {
    if (this._data[key]) {
      delete this._data[key]
      this._save()
      logger.info(`AgentMemory: Deleted "${key}"`)
      return true
    }
    return false
  }

  /**
   * Returns a compact summary of all memory visible in the current context.
   */
  getSummary (guildId = null, maxChars = 8000) {
    this._pruneExpired()
    const entries = Object.entries(this._data).filter(([, e]) => {
      if (guildId === 'all') return true
      if (e.guildId === null || e.guildId === undefined) return true
      return e.guildId === guildId
    })
    if (entries.length === 0) return null

    const lines = entries
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .map(([k, v]) => {
        const valStr = (typeof v.value === 'object' && v.value !== null) ? JSON.stringify(v.value) : v.value
        return `- ${k}: ${valStr}`
      })

    let summary = lines.join('\n')
    if (summary.length > maxChars) {
      summary = summary.substring(0, maxChars) + '\n...(truncated)'
    }
    return summary
  }

  /**
   * Returns the raw data map, optionally filtered by guildId visibility.
   */
  getAll (guildId = null) {
    this._pruneExpired()
    if (guildId === undefined) return { ...this._data }
    return Object.fromEntries(
      Object.entries(this._data).filter(([, e]) =>
        e.guildId === null || e.guildId === undefined || e.guildId === guildId
      )
    )
  }

  /**
   * Returns total number of stored entries.
   */
  size () {
    return Object.keys(this._data).length
  }
}

module.exports = new AgentMemory()
