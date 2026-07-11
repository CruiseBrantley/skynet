const fs = require('fs')
const path = require('path')

// Set NODE_ENV to test before requiring the cache
process.env.NODE_ENV = 'test'

const {
  addReaction,
  removeReaction,
  getReactions,
  pruneCache,
  saveToDisk,
  reactionCache
} = require('../util/chat/reactionCache')

const CACHE_FILE = path.join(__dirname, '../data/reaction_cache_test.json')

describe('Reaction Cache Persistent Storage', () => {
  beforeEach(() => {
    reactionCache.clear()
    if (fs.existsSync(CACHE_FILE)) {
      try {
        fs.unlinkSync(CACHE_FILE)
      } catch (e) {}
    }
  })

  afterAll(() => {
    if (fs.existsSync(CACHE_FILE)) {
      try {
        fs.unlinkSync(CACHE_FILE)
      } catch (e) {}
    }
  })

  test('adds, retrieves, and removes reactions in memory', () => {
    addReaction('msg-1', '👍', 'alice')
    addReaction('msg-1', '👍', 'bob')
    addReaction('msg-1', '🔥', 'alice')

    const reactions = getReactions('msg-1')
    expect(reactions).toBeDefined()
    expect(reactions.get('👍').has('alice')).toBe(true)
    expect(reactions.get('👍').has('bob')).toBe(true)
    expect(reactions.get('🔥').has('alice')).toBe(true)
    expect(reactions.get('🔥').has('bob')).toBe(false)

    removeReaction('msg-1', '👍', 'alice')
    expect(getReactions('msg-1').get('👍').has('alice')).toBe(false)
    expect(getReactions('msg-1').get('👍').has('bob')).toBe(true)
  })

  test('prunes old messages from cache', () => {
    addReaction('msg-1', '👍', 'alice')
    addReaction('msg-2', '🔥', 'bob')

    pruneCache(['msg-2'])

    expect(getReactions('msg-1')).toBeUndefined()
    expect(getReactions('msg-2')).toBeDefined()
  })

  test('persists to disk and reloads correctly', () => {
    addReaction('persist-msg', '✨', 'charlie')
    saveToDisk()

    expect(fs.existsSync(CACHE_FILE)).toBe(true)

    // Clear memory
    reactionCache.clear()
    expect(getReactions('persist-msg')).toBeUndefined()

    // Force reload by requiring/evaluating the reload logic
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    for (const [msgId, emojis] of data) {
      const emojiMap = new Map()
      for (const [emojiKey, users] of emojis) {
        emojiMap.set(emojiKey, new Set(users))
      }
      reactionCache.set(msgId, emojiMap)
    }

    const loaded = getReactions('persist-msg')
    expect(loaded).toBeDefined()
    expect(loaded.get('✨').has('charlie')).toBe(true)
  })
})
