const AgentTurnManager = require('../util/chat/AgentTurnManager')
const agentMemory = require('./memory')
const stateStore = require('./state')
const { getBasePrompt } = require('../util/systemPrompt')

/**
 * Universal Agent Turn Entry Point (Headless & Platform-Agnostic).
 * Executes a full multi-step ReAct agent turn with Universal AI Turn Coordinator reflection.
 *
 * @param {object} params
 * @param {string} params.message - Raw user input text.
 * @param {Array<{ role: string, content: string }>} [params.history] - Array of past messages.
 * @param {object} [params.context] - Additional context metadata (e.g. userId, userName, channelId, isCodeTask).
 * @param {object} [params.memory] - Agent memory instance (defaults to core/memory).
 * @param {object} [params.state] - State store instance (defaults to core/state).
 * @param {number} [params.maxSteps=25] - Max ReAct tool execution steps.
 * @returns {Promise<{ success: boolean, replyContent: string, executedTools: Array<object> }>}
 */
async function agentTurn ({
  message = '',
  history = [],
  context = {},
  memory = agentMemory,
  state = stateStore,
  maxSteps = 25,
  botName = process.env.BOT_NAME || 'Skynet'
} = {}) {
  const turnManager = new AgentTurnManager({ botName })

  // Construct standard channel history
  const channelHistory = {
    messages: [
      { role: 'system', content: getBasePrompt() },
      ...history
    ]
  }

  if (message) {
    channelHistory.messages.push({
      role: 'user',
      content: message
    })
  }

  // Create lightweight normalized interaction handle for tool routing
  const NormalizedInteraction = require('../interfaces/NormalizedInteraction')
  const normalized = new NormalizedInteraction({
    clientId: context.clientId || 'core',
    user: { id: context.userId || 'user', username: context.userName || 'User' },
    channel: { id: context.channelId || 'session', name: context.channelName || 'session' },
    guildId: context.guildId || null,
    options: context.options || {}
  })

  return await turnManager.executeTurn({
    interaction: normalized,
    database: null,
    channelHistory,
    ollamaContext: {
      isCodeTask: Boolean(context.isCodeTask)
    },
    maxSteps
  })
}

module.exports = {
  agentTurn,
  AgentTurnManager
}
