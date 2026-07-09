const reactionCache = new Map() // messageId -> Map<emojiKey, Set<string>> (usernames)

function addReaction (messageId, emojiKey, username) {
  if (!reactionCache.has(messageId)) {
    reactionCache.set(messageId, new Map())
  }
  const msgReactions = reactionCache.get(messageId)
  if (!msgReactions.has(emojiKey)) {
    msgReactions.set(emojiKey, new Set())
  }
  msgReactions.get(emojiKey).add(username)
}

function removeReaction (messageId, emojiKey, username) {
  const msgReactions = reactionCache.get(messageId)
  if (!msgReactions) return
  const users = msgReactions.get(emojiKey)
  if (!users) return
  users.delete(username)
  if (users.size === 0) {
    msgReactions.delete(emojiKey)
  }
  if (msgReactions.size === 0) {
    reactionCache.delete(messageId)
  }
}

function getReactions (messageId) {
  return reactionCache.get(messageId)
}

function pruneCache (activeMessageIds) {
  for (const messageId of reactionCache.keys()) {
    if (!activeMessageIds.includes(messageId)) {
      reactionCache.delete(messageId)
    }
  }
}

module.exports = {
  addReaction,
  removeReaction,
  getReactions,
  pruneCache
}
