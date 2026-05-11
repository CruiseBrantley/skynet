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

  const timeoutMs = 20000 // 20s base timeout for more reliable failover

  // Level 1: Gemini API Tier (The first reliable fail-over)
  if (fallbackLevel === 1) {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      logger.error('GEMINI_API_KEY is not configured in .env and fallback reached Level 1.')
      return queryOllama(endpoint, payload, 2) // Drop to local if API key is missing
    }

    logger.info(`Triggering Level 1 fallback: Gemini-3.1-flash-lite for ${endpoint}`)

    let geminiMessages = []
    if (payload.messages) {
      geminiMessages = payload.messages.map(msg => {
        const role = msg.role === 'assistant' ? 'assistant' : 'user'
        if (msg.images && msg.images.length > 0) {
          const contentBlocks = [{ type: 'text', text: msg.content || '' }]
          msg.images.forEach(img => {
            const dataUrl = img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`
            contentBlocks.push({ type: 'image_url', image_url: { url: dataUrl } })
          })
          return { role, content: contentBlocks }
        }
        return { role, content: msg.content || '' }
      })
    } else if (payload.prompt) {
      geminiMessages = [{ role: 'user', content: payload.prompt }]
    }

    const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview'

    try {
      const response = await axios.post(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        {
          model: geminiModel,
          messages: geminiMessages,
          stream: false
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: timeoutMs
        }
      )

      if (response.data.choices && response.data.choices[0]) {
        const content = response.data.choices[0].message.content
        if (endpoint === '/api/generate') {
          return { response: content }
        }
        return { message: { role: 'assistant', content } }
      }
      throw new Error('Invalid response structure from Gemini API')
    } catch (err) {
      logger.error(`Gemini fallback failed: ${err.message}. Dropping to Level 2 (Local).`)
      return queryOllama(endpoint, payload, 2)
    }
  }

  // Level 2: Local Fallback (The final fail-safe)
  // Model: gemma4:e4b (keeps in RAM for fast responses)
  if (fallbackLevel >= 2) {
    const localUrl = `http://127.0.0.1:11434${endpoint}`
    const localModel = process.env.OLLAMA_LOCAL_MODEL || 'gemma4:e4b'

    logger.info(`Triggering Level 2 fallback: Local Ollama (${localModel}) for ${endpoint}`)

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
      const response = await axios.post(localUrl, { ...payload, model: localModel, stream: false }, { timeout: 45000 }) // 45s for local load

      const data = response.data
      if (data && data.message) {
        if (data.message.thinking) {
          logger.info(`Local Model [${localModel}] Thinking: ${data.message.thinking.substring(0, 150)}...`)
        }
        if (typeof data.message.content === 'string') return data
      } else if (data && data.response) {
        return { message: { role: 'assistant', content: data.response } }
      }
      return data
    } catch (err) {
      logger.error(`Final local fallback failed: ${err.message}`)
      throw new Error('All fallback tiers (Remote, Gemini, Local) are unreachable.')
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
      if (typeof data.message.content === 'string') {
        logger.info(`queryOllama: Level 0 Chat Success from ${remoteHost}`)
        return data
      }
    } else if (data && data.response) {
      logger.info(`queryOllama: Level 0 Legacy Success from ${remoteHost} (Mapped to Chat)`)
      return { message: { role: 'assistant', content: data.response } }
    }

    throw new Error('Malformed Ollama response: Missing both message.content and response fields.')
  } catch (err) {
    logger.info(`Primary Ollama failed or malformed, falling back to Gemini: ${err.message}`)
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

  const localModel = process.env.OLLAMA_LOCAL_MODEL || 'gemma4:e4b'
  const currentModel = (remoteHost && remoteModel && (await checkPortOpen(remoteHost, remotePort, 1000))) ? remoteModel : localModel
  const isGemma4 = currentModel.toLowerCase().includes('gemma4')

  // Inject enhancements
  if (isGemma4) {
    payload.think = true
    if (!payload.options) payload.options = {}
    if (!payload.options.num_ctx || payload.options.num_ctx < 131072) {
      payload.options.num_ctx = 131072
    }
  }

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

  // Fall through to local — never calls Gemini (level 2 directly)
  return queryOllama(endpoint, payload, 2)
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
    systemPrompt = ''
  } = options

  const agentMemory = require('./AgentMemory')
  const memorySummary = agentMemory.getSummary(guildId)
  const memoryBlock = memorySummary ? `\n\nLONG-TERM MEMORY & ACTIVE RULES:\n${memorySummary}` : ''
  const sysMsg = `${systemPrompt}\n\nCURRENT SYSTEM DATE & TIME:\n${new Date().toLocaleString('en-US', { timeZoneName: 'short' })}${memoryBlock}\n\nCURRENT APPLICATION STATE:\n${commandsContext}\n\n${logsContext}`

  const processedMessages = messages.map((msg, idx) => {
    if (idx === 0 && msg.role === 'system') {
      return { ...msg, content: sysMsg }
    }
    return msg
  })

  const localModel = process.env.OLLAMA_LOCAL_MODEL || 'gemma4:e4b'
  const remoteModel = process.env.OLLAMA_REMOTE_MODEL
  const currentModel = (isBackup || !remoteModel) ? localModel : remoteModel

  // Gemma 4 Enhancements: 128k context, Thinking mode, and Automatic Speculative Decoding (MTP)
  const isGemma4 = currentModel.toLowerCase().includes('gemma4')
  const numCtx = isGemma4 ? 131072 : 8192
  const think = isGemma4

  try {
    const result = await queryOllama('/api/chat', {
      messages: processedMessages,
      think,
      options: {
        num_ctx: numCtx,
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

module.exports = {
  queryOllama,
  queryOllamaWithContext,
  checkOllamaOnline,
  queryLocalOrRemote
}
