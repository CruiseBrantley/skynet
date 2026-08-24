const fs = require('fs')
const path = require('path')
const logger = require('../logger')

const DATA_DIR = path.join(__dirname, '../data')
const STATE_FILE = path.join(DATA_DIR, 'operational_state.json')

class StateStore {
  constructor () {
    this._state = new Map()
    this._database = null
    this._syncTimer = null
    this._ensureDataDir()
    this._load()
  }

  _ensureDataDir () {
    try {
      if (typeof fs.existsSync === 'function' && !fs.existsSync(DATA_DIR)) {
        if (typeof fs.mkdirSync === 'function') {
          fs.mkdirSync(DATA_DIR, { recursive: true })
        }
      }
    } catch (_) {}
  }

  /**
   * Initializes Firebase cloud sync.
   * Hydrates from Firebase if available, otherwise seeds Firebase with local state.
   */
  init (database) {
    this._database = database
    if (!this._database || typeof this._database.ref !== 'function') return

    try {
      const stateRef = this._database.ref('operational_state')
      stateRef.once('value').then(snapshot => {
        if (snapshot && typeof snapshot.exists === 'function' && snapshot.exists()) {
          const remoteState = snapshot.val()
          if (Array.isArray(remoteState)) {
            for (const item of remoteState) {
              if (item && item.key && !this._state.has(item.key)) {
                const { key, ...rest } = item
                this._state.set(key, rest)
              }
            }
            this._saveLocalOnly()
            logger.info(`StateStore: Hydrated ${remoteState.length} state keys from Firebase.`)
          } else if (remoteState && typeof remoteState === 'object') {
            for (const [k, v] of Object.entries(remoteState)) {
              if (!this._state.has(k)) {
                this._state.set(k, v)
              }
            }
            this._saveLocalOnly()
            logger.info(`StateStore: Hydrated ${Object.keys(remoteState).length} state keys from Firebase.`)
          }
        } else if (this._state.size > 0) {
          this._syncRemote()
          logger.info('StateStore: Seeded Firebase with initial local operational state.')
        }
      }).catch(err => {
        logger.warn(`StateStore: Firebase initial sync warning: ${err.message}`)
      })
    } catch (err) {
      logger.warn(`StateStore: Failed to setup Firebase sync: ${err.message}`)
    }
  }

  _syncRemote () {
    if (!this._database || typeof this._database.ref !== 'function') return
    if (this._syncTimer) clearTimeout(this._syncTimer)

    this._syncTimer = setTimeout(() => {
      try {
        const list = []
        for (const [k, v] of this._state.entries()) {
          list.push({ key: k, ...v })
        }
        this._database.ref('operational_state').set(list)
          .then(() => logger.debug('StateStore: Successfully synced state to Firebase.'))
          .catch(e => logger.warn(`StateStore: Firebase sync error: ${e.message}`))
      } catch (err) {
        logger.warn(`StateStore: Failed to dispatch Firebase sync: ${err.message}`)
      }
    }, 500)
    if (this._syncTimer.unref) this._syncTimer.unref()
  }

  _pruneExpired () {
    const now = Date.now()
    let pruned = false
    for (const [key, entry] of this._state.entries()) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        this._state.delete(key)
        pruned = true
      }
    }
    return pruned
  }

  _load () {
    try {
      if (typeof fs.existsSync === 'function' && fs.existsSync(STATE_FILE)) {
        if (typeof fs.readFileSync === 'function') {
          const raw = fs.readFileSync(STATE_FILE, 'utf8')
          const parsed = JSON.parse(raw)
          this._state.clear()
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const [k, v] of Object.entries(parsed)) {
              this._state.set(k, v)
            }
            this._pruneExpired()
            return
          }
        }
      }
    } catch (err) {
      logger.warn(`StateStore: Failed to load state from disk: ${err.message}`)
    }
    this._state = new Map()
  }

  _saveLocalOnly () {
    try {
      this._ensureDataDir()
      this._pruneExpired()
      const obj = {}
      for (const [k, v] of this._state.entries()) {
        obj[k] = v
      }
      if (typeof fs.writeFileSync === 'function') {
        fs.writeFileSync(STATE_FILE, JSON.stringify(obj, null, 2), 'utf8')
      }
    } catch (err) {
      logger.error(`StateStore: Failed to save state to disk: ${err.message}`)
    }
  }

  _save () {
    this._saveLocalOnly()
    this._syncRemote()
  }

  get (key, defaultValue = null) {
    if (!key) return defaultValue
    const cleanKey = String(key).trim()
    const entry = this._state.get(cleanKey)
    if (!entry) return defaultValue

    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this._state.delete(cleanKey)
      this._save()
      return defaultValue
    }

    return entry.value !== undefined ? entry.value : defaultValue
  }

  getEntry (key) {
    if (!key) return null
    const cleanKey = String(key).trim()
    return this._state.get(cleanKey) || null
  }

  set (key, value, { ttlDays = 30, metadata = {} } = {}) {
    if (!key) throw new Error('Key is required for StateStore.set')
    const cleanKey = String(key).trim()
    const now = Date.now()
    const expiresAt = (ttlDays && ttlDays > 0) ? (now + (ttlDays * 24 * 60 * 60 * 1000)) : null

    const entry = {
      value,
      updatedAt: now,
      updatedAtIso: new Date(now).toISOString(),
      expiresAt,
      metadata: metadata || {}
    }

    this._state.set(cleanKey, entry)
    this._save()
    return entry
  }

  delete (key) {
    if (!key) return false
    const cleanKey = String(key).trim()
    const existed = this._state.delete(cleanKey)
    if (existed) this._save()
    return existed
  }

  diff (key, newValue) {
    const existing = this.get(key, null)
    const existingStr = JSON.stringify(existing)
    const newStr = JSON.stringify(newValue)
    const hasChanged = existingStr !== newStr

    return {
      hasChanged,
      previousValue: existing,
      newValue
    }
  }

  listKeys () {
    this._pruneExpired()
    return Array.from(this._state.keys())
  }

  getAll () {
    this._pruneExpired()
    const obj = {}
    for (const [k, v] of this._state.entries()) {
      obj[k] = v.value
    }
    return obj
  }
}

module.exports = new StateStore()
