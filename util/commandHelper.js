/**
 * Intelligent parameter extractor for autonomous commands.
 * Handles both flat structure {"command": "...", "key": "value"}
 * and nested structure {"command": "...", "params": {"key": "value"}}.
 *
 * Also provides fallbacks for common generic field names.
 *
 * @param {object} cmdData - The parsed JSON from the AI
 * @param {string} key - The parameter name to retrieve
 * @returns {any|null} - The found value or null
 */
function getParam (cmdData, key) {
  if (!cmdData || typeof cmdData !== 'object') return null

  // 1. Direct match
  if (cmdData[key] !== undefined) return cmdData[key]

  // 2. Nested params match
  if (cmdData.params && typeof cmdData.params === 'object' && cmdData.params[key] !== undefined) {
    return cmdData.params[key]
  }

  // 3. Common semantic fallbacks for specific keys
  const fallbacks = {
    message: ['content', 'text', 'description', 'payload'],
    content: ['message', 'text', 'description', 'payload'],
    query: ['search', 'q', 'topic', 'text'],
    options: ['choices', 'items', 'list', 'option'],
    id: ['task_id', 'target_id', 'name'],
    channel: ['channelId', 'target', 'channel_id', 'location']
  }

  if (fallbacks[key]) {
    for (const fallbackKey of fallbacks[key]) {
      if (cmdData[fallbackKey] !== undefined) return cmdData[fallbackKey]
      if (cmdData.params?.[fallbackKey] !== undefined) return cmdData.params[fallbackKey]
    }
  }

  return null
}

module.exports = { getParam }
