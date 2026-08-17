const net = require('net')
const axios = require('axios')
const logger = require('../logger')

/**
 * Perform a quick TCP connection check.
 */
function checkPortOpen (host, port, timeout = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.unref() // Don't keep the process alive for this check

    const cleanup = () => {
      socket.removeAllListeners()
      socket.destroy()
    }

    const onError = () => {
      cleanup()
      resolve(false)
    }

    socket.setTimeout(timeout)
    socket.once('error', onError)
    socket.once('timeout', onError)

    socket.connect(port, host, () => {
      cleanup()
      resolve(true)
    })
  })
}

async function checkOllamaOnline (url, endpoint) {
  try {
    const baseUrl = url.replace(endpoint, '')
    await axios.get(`${baseUrl}/api/tags`, { timeout: 1000 })
    return true
  } catch (e) {
    return false
  }
}

/**
 * Queries Ollama with automatic failover from remote PC to Gemini to local fallback.
 * @param {string} endpoint - The API endpoint e.g., '/api/chat' or '/api/generate'
 * @param {object} payload - The request body (e.g. messages: [], prompt: "")
 * @param {number|boolean} fallbackLevel - 0: remote Ollama, 1: Gemini, 2: local Ollama
 * @returns {Promise<object>} The normalized response data
 */
async function queryOllama (endpoint, payload, fallbackLevel = 0) {
  logger.info(`queryOllama: Entry [Level ${fallbackLevel}] for ${endpoint}`)
  // Handle backwards compatibility for boolean isBackup
  if (fallbackLevel === true) fallbackLevel = 1
  if (fallbackLevel === false) fallbackLevel = 0

  const timeoutMs = 180000 // 180s base timeout for more reliable failover/thinking models

  // Level 1: Local Mac Fallback (Unlimited local hardware fallback)
  if (fallbackLevel === 1) {
    const localUrl = `http://127.0.0.1:11434${endpoint}`
    const localModel = process.env.OLLAMA_LOCAL_MODEL || 'gemma4:e4b'

    logger.info(`Triggering Level 1 fallback: Local Ollama (${localModel}) for ${endpoint}`)

    // Try to start local Ollama if offline
    let isOnline = await checkPortOpen('127.0.0.1', 11434, 1000)
    if (!isOnline) {
      logger.info('Local Ollama is offline. Attempting to start with \'open -a Ollama\'...')
      const { exec } = require('child_process')
      exec('open -a Ollama')
      // Give it more time to spin up if it was completely closed
      for (let i = 0; i < 8; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        isOnline = await checkPortOpen('127.0.0.1', 11434, 1000)
        if (isOnline) break
      }
    }

    try {
      // Debug: log the full payload to see the system prompt and context for the local model
      if (payload.messages) {
        logger.debug(`Local Model Payload (${localModel}): ${JSON.stringify(payload.messages, null, 2)}`)
      }
      const response = await axios.post(localUrl, { ...payload, model: localModel, stream: false }, { timeout: 180000 }) // 180s for local load

      const data = response.data
      if (data && data.message) {
        if (data.message.thinking) {
          logger.info(`Local Model [${localModel}] Thinking: ${data.message.thinking.substring(0, 150)}...`)
        }
        if (typeof data.message.content === 'string' && data.message.content.trim().length > 0) return data
        if (typeof data.message.content === 'string' && data.message.content.trim().length === 0) {
          throw new Error(`Local Model ${localModel} produced empty content.`)
        }
      } else if (data && data.response && data.response.trim().length > 0) {
        return { message: { role: 'assistant', content: data.response } }
      }
      throw new Error(`Local Model ${localModel} returned malformed response.`)
    } catch (err) {
      logger.error(`Local Ollama fallback failed: ${err.message}. Dropping to Level 2 (Gemini).`)
      return queryOllama(endpoint, payload, 2)
    }
  }

  // Level 2: Gemini API Tier (Final Cloud API Fallback — preserves quota)
  if (fallbackLevel >= 2) {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      logger.error('GEMINI_API_KEY is not configured in .env and fallback reached Level 2.')
      throw new Error('All fallback tiers (Remote PC, Local Mac, Gemini API) are unreachable.')
    }

    const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash'
    logger.info(`Triggering Level 2 fallback: ${geminiModel} for ${endpoint}`)

    let geminiContents = []
    if (payload.messages) {
      geminiContents = payload.messages.map(msg => {
        const role = msg.role === 'assistant' ? 'model' : 'user'
        if (msg.images && msg.images.length > 0) {
          const parts = [{ text: msg.content || '' }]
          msg.images.forEach(img => {
            const base64Data = img.startsWith('data:') ? img.split(',')[1] : img
            parts.push({
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64Data
              }
            })
          })
          return { role, parts }
        }
        return { role, parts: [{ text: msg.content || '' }] }
      })
    } else if (payload.prompt) {
      geminiContents = [{ role: 'user', parts: [{ text: payload.prompt }] }]
    }

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1/models/${geminiModel}:generateContent?key=${apiKey}`,
        {
          contents: geminiContents
        },
        {
          timeout: timeoutMs
        }
      )

      if (response.data.candidates && response.data.candidates[0]?.content?.parts?.[0]) {
        const content = response.data.candidates[0].content.parts[0].text
        if (endpoint === '/api/generate') {
          return { response: content }
        }
        return { message: { role: 'assistant', content } }
      }
      throw new Error('Invalid response structure from Gemini API')
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message
      logger.error(`Final Gemini fallback failed: ${errMsg}`)
      throw new Error('All fallback tiers (Remote PC, Local Mac, Gemini API) are unreachable.')
    }
  }

  // Level 0: Primary Remote Workstation
  const remoteHost = process.env.OLLAMA_REMOTE_HOST
  const remotePort = parseInt(process.env.OLLAMA_REMOTE_PORT) || 11434
  const remoteUrl = `http://${remoteHost}:${remotePort}${endpoint}`
  const remoteModel = process.env.OLLAMA_REMOTE_MODEL

  // If no remote host is configured, skip straight to Level 1
  if (!remoteHost || !remoteModel) {
    return queryOllama(endpoint, payload, 1)
  }

  // Quick TCP pre-flight check (1s timeout)
  const isOnline = await checkPortOpen(remoteHost, remotePort, 1000)
  if (!isOnline) {
    logger.info('Primary Ollama PC is unreachable via TCP. Skipping to Level 1 (Local).')
    return queryOllama(endpoint, payload, 1)
  }
  try {
    const response = await axios.post(remoteUrl, { ...payload, model: remoteModel, stream: false }, { timeout: timeoutMs })

    // NORMALIZATION LAYER: Ensure we always have a message.content structure
    const data = response.data
    if (data && data.message) {
      if (data.message.thinking) {
        logger.info(`Remote Model [${remoteModel}] Thinking from ${remoteHost}: ${data.message.thinking.substring(0, 150)}...`)
      }
      if (typeof data.message.content === 'string' && data.message.content.trim().length > 0) {
        logger.info(`queryOllama: Level 0 Chat Success from ${remoteHost}`)
        return data
      }
      if (typeof data.message.content === 'string' && data.message.content.trim().length === 0) {
        logger.warn(`Remote Model [${remoteModel}] returned empty content string. Falling back to Level 1.`)
        throw new Error(`Remote Model ${remoteModel} produced empty content.`)
      }
    } else if (data && data.response && data.response.trim().length > 0) {
      logger.info(`queryOllama: Level 0 Legacy Success from ${remoteHost} (Mapped to Chat)`)
      return { message: { role: 'assistant', content: data.response } }
    }

    throw new Error('Malformed Ollama response: Missing valid message.content or response fields.')
  } catch (err) {
    logger.info(`Primary Ollama failed or returned empty, falling back to Level 1: ${err.message}`)
    return queryOllama(endpoint, payload, 1)
  }
}

/**
 * Queries Ollama using ONLY local Mac or remote PC — never Gemini.
 * Safe for background agent tasks (schedulers, loops) where API costs must be avoided.
 * Priority: Remote PC (level 0) → Local Mac (level 2). Gemini (level 1) is explicitly skipped.
 * @param {string} endpoint
 * @param {object} payload
 */
async function queryLocalOrRemote (endpoint, payload) {
  const remoteHost = process.env.OLLAMA_REMOTE_HOST
  const remotePort = parseInt(process.env.OLLAMA_REMOTE_PORT) || 11434
  const remoteModel = process.env.OLLAMA_REMOTE_MODEL
  const timeoutMs = 120_000 // 2 min — background tasks get less priority

  // Background agent tasks are lightweight evaluations (maintenance / NOOP checks).
  // Disable heavy chain-of-thought thinking and cap token prediction to avoid pegging GPU.
  if (!payload.options) payload.options = {}
  if (!payload.options.num_ctx) payload.options.num_ctx = 8192
  if (payload.options.num_predict === undefined) payload.options.num_predict = 256
  if (payload.think === undefined) payload.think = false

  if (remoteHost && remoteModel) {
    const isOnline = await checkPortOpen(remoteHost, remotePort, 1000)
    if (isOnline) {
      try {
        const remoteUrl = `http://${remoteHost}:${remotePort}${endpoint}`
        const response = await axios.post(
          remoteUrl,
          { ...payload, model: remoteModel, stream: false },
          { timeout: timeoutMs }
        )
        return response.data
      } catch (err) {
        logger.info(`queryLocalOrRemote: Remote PC failed, falling to local: ${err.message}`)
      }
    }
  }

  // Fall through to local — never calls Gemini (level 1 is local)
  return queryOllama(endpoint, payload, 1)
}

/**
 * Advanced wrapper for queryOllama that handles memory injection, context blocks,
 * and system prompt management. Used primarily by the chat command.
 */
async function queryOllamaWithContext (messages, options, botName = 'Skynet') {
  const {
    isBackup = false,
    commandsContext = '',
    logsContext = '',
    guildId = null,
    systemPrompt = '',
    userId = null
  } = options

  const localModel = process.env.OLLAMA_LOCAL_MODEL || 'qwen3.5:9b'
  const remoteModel = process.env.OLLAMA_REMOTE_MODEL
  const currentModel = (isBackup || !remoteModel) ? localModel : remoteModel

  // Qwen & Gemma 4 Family Enhancements:
  const isQwen = currentModel.toLowerCase().includes('qwen')
  const isQwen3 = currentModel.toLowerCase().includes('qwen3')
  const isGemma4 = currentModel.toLowerCase().includes('gemma4')

  let numCtx = 8192
  let think = false
  let maxMemoryChars = 3500 // Cap for local Mac fallback (Level 2)

  if (isBackup) {
    // Level 1 Backup is Gemini API (1M token context window)
    maxMemoryChars = 8000
  } else if (isQwen3) {
    numCtx = 65536 // 64k context window on RTX 5090
    maxMemoryChars = 8000 // Full deep memory history for 5090
    think = true
  } else if (isQwen) {
    numCtx = 16384
    maxMemoryChars = 3500
  } else if (isGemma4) {
    numCtx = 16384 // Cap at 16k for fast local execution on Mac Mini
    maxMemoryChars = 3500
    think = true
  }

  const agentMemory = require('./AgentMemory')
  const isOwner = userId === process.env.OWNER_ID
  const isDM = !guildId
  const memorySummary = (isOwner && isDM)
    ? agentMemory.getSummary('all', maxMemoryChars)
    : agentMemory.getSummary(guildId, maxMemoryChars)
  const memoryBlock = memorySummary ? `\n\nLONG-TERM MEMORY & ACTIVE RULES:\n${memorySummary}` : ''
  let sysMsg = `${systemPrompt}\n\nCURRENT SYSTEM DATE & TIME:\n${new Date().toLocaleString('en-US', { timeZoneName: 'short' })}${memoryBlock}\n\nCURRENT APPLICATION STATE:\n${commandsContext}\n\n${logsContext}`

  if (isOwner && isDM) {
    sysMsg += '\n\nCREATOR SPECIAL ACCESS (DMs ONLY):\n' +
      'You are communicating directly with your creator (owner) in DMs.\n' +
      'You have full administrative access to view, update, and manage all scheduled tasks and agent memories across ALL servers.\n' +
      'When the creator asks you to remember, recall, list, schedule, or cancel tasks/memories for other servers, execute those commands. Do not filter tasks by guild.'
  }

  const processedMessages = messages.map((msg, idx) => {
    if (idx === 0 && msg.role === 'system') {
      return { ...msg, content: sysMsg }
    }
    return msg
  })

  try {
    const result = await queryOllama('/api/chat', {
      messages: processedMessages,
      think,
      options: {
        num_ctx: numCtx,
        num_predict: -1, // -1 in Ollama = unlimited generation (runs until natural EOS)
        temperature: 0.3,
        top_k: 40,
        top_p: 0.9
      }
    }, isBackup)
    return result
  } catch (err) {
    if (!isBackup) {
      logger.info(`Primary Ollama failed, falling back to backup: ${err.message}`)
      return queryOllamaWithContext(messages, { ...options, isBackup: true }, botName)
    }
    throw err
  }
}

/**
 * Helper to check current active model tier and recommended prompt/context limits.
 */
async function getActiveModelCapabilities () {
  const remoteHost = process.env.OLLAMA_REMOTE_HOST
  const remotePort = parseInt(process.env.OLLAMA_REMOTE_PORT) || 11434
  const remoteModel = process.env.OLLAMA_REMOTE_MODEL

  const isRemoteOnline = remoteHost && remoteModel && (await checkPortOpen(remoteHost, remotePort, 1000))

  if (isRemoteOnline) {
    return {
      tier: 'remote_5090',
      modelName: remoteModel,
      maxContextTokens: 65536,
      maxDigestMessages: 100,
      supportsDeepResearch: true
    }
  }

  // Local Mac Fallback (Level 1)
  const localModel = process.env.OLLAMA_LOCAL_MODEL || 'gemma4:e4b'
  return {
    tier: 'local_mac',
    modelName: localModel,
    maxContextTokens: 16384,
    maxDigestMessages: 25,
    supportsDeepResearch: false // Simplified single-pass search
  }
}

module.exports = {
  queryOllama,
  queryOllamaWithContext,
  checkOllamaOnline,
  queryLocalOrRemote,
  getActiveModelCapabilities
}
