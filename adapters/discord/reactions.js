const fs = require('fs')
const path = require('path')
const logger = require('../../logger')

const CACHE_FILE = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, '../../data/reaction_cache_test.json')
  : path.join(__dirname, '../../data/reaction_cache.json')

const reactionCache = new Map() // messageId -> Map<emojiKey, Set<string>> (usernames)

// Load cache on startup
loadFromDisk()

function loadFromDisk () {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
      for (const [msgId, emojis] of data) {
        const emojiMap = new Map()
        for (const [emojiKey, users] of emojis) {
          emojiMap.set(emojiKey, new Set(users))
        }
        reactionCache.set(msgId, emojiMap)
      }
      logger.info(`Loaded ${reactionCache.size} message reaction caches from disk persistent storage.`)
    } catch (err) {
      logger.error(`Failed to load reaction cache: ${err.message}`)
    }
  }
}

function saveToDisk () {
  try {
    const dir = path.dirname(CACHE_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const serialized = []
    for (const [msgId, emojiMap] of reactionCache.entries()) {
      const emojis = []
      for (const [emojiKey, userSet] of emojiMap.entries()) {
        emojis.push([emojiKey, [...userSet]])
      }
      serialized.push([msgId, emojis])
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(serialized, null, 2), 'utf8')
  } catch (err) {
    logger.error(`Failed to save reaction cache: ${err.message}`)
  }
}

let saveTimeout = null
function queueSave () {
  if (saveTimeout) return
  saveTimeout = setTimeout(() => {
    saveTimeout = null
    saveToDisk()
  }, 5000) // debounce disk write to 5 seconds
}

function addReaction (messageId, emojiKey, username) {
  if (!reactionCache.has(messageId)) {
    reactionCache.set(messageId, new Map())
  }
  const msgReactions = reactionCache.get(messageId)
  if (!msgReactions.has(emojiKey)) {
    msgReactions.set(emojiKey, new Set())
  }
  const prevSize = msgReactions.get(emojiKey).size
  msgReactions.get(emojiKey).add(username)
  if (msgReactions.get(emojiKey).size !== prevSize) {
    queueSave()
  }
}

function removeReaction (messageId, emojiKey, username) {
  const msgReactions = reactionCache.get(messageId)
  if (!msgReactions) return
  const users = msgReactions.get(emojiKey)
  if (!users) return
  const deleted = users.delete(username)
  if (deleted) {
    if (users.size === 0) {
      msgReactions.delete(emojiKey)
    }
    if (msgReactions.size === 0) {
      reactionCache.delete(messageId)
    }
    queueSave()
  }
}

function getReactions (messageId) {
  return reactionCache.get(messageId)
}

function pruneCache (activeMessageIds) {
  let changed = false
  for (const messageId of reactionCache.keys()) {
    if (!activeMessageIds.includes(messageId)) {
      reactionCache.delete(messageId)
      changed = true
    }
  }
  if (changed) {
    queueSave()
  }
}

module.exports = {
  addReaction,
  removeReaction,
  getReactions,
  pruneCache,
  saveToDisk,
  reactionCache // exported for testing/clearing
}
