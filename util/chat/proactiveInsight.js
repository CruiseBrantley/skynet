const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js')
const { jsonrepair } = require('jsonrepair')
const logger = require('../../logger')
const ollama = require('../ollama')

// Cache configuration (TTL: 2 hours)
const INSIGHT_TTL_MS = 2 * 60 * 60 * 1000
const insightStore = new Map()

const CACHE_FILE = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, '../../data/insight_cache_test.json')
  : path.join(__dirname, '../../data/insight_cache.json')

function loadFromDisk () {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
      const now = Date.now()
      for (const item of data) {
        if (item && item.id && now - item.createdAt < INSIGHT_TTL_MS) {
          insightStore.set(item.id, item)
        }
      }
      logger.info(`Loaded ${insightStore.size} insights from disk persistent storage.`)
    } catch (err) {
      logger.error(`Failed to load insight cache: ${err.message}`)
    }
  }
}

function saveToDisk () {
  try {
    const dir = path.dirname(CACHE_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const serialized = Array.from(insightStore.values())
    fs.writeFileSync(CACHE_FILE, JSON.stringify(serialized, null, 2), 'utf8')
  } catch (err) {
    logger.error(`Failed to save insight cache: ${err.message}`)
  }
}

let saveTimeout = null
function queueSave () {
  if (process.env.NODE_ENV === 'test') {
    saveToDisk()
    return
  }
  if (saveTimeout) return
  saveTimeout = setTimeout(() => {
    saveTimeout = null
    saveToDisk()
  }, 2000)
  if (saveTimeout.unref) saveTimeout.unref()
}

// Load cache on startup
loadFromDisk()

// Periodic sweep to evict expired insights
const sweepTimer = setInterval(() => {
  const now = Date.now()
  let modified = false
  for (const [id, item] of insightStore.entries()) {
    if (now - item.createdAt > INSIGHT_TTL_MS) {
      insightStore.delete(id)
      modified = true
    }
  }
  if (modified) {
    queueSave()
  }
}, 10 * 60 * 1000)
if (sweepTimer.unref) sweepTimer.unref()

/**
 * Store an insight into the cache.
 * @param {string} id
 * @param {string} content
 * @param {string} teaser
 * @returns {object}
 */
function storeInsight (id, content, teaser) {
  const item = {
    id,
    content,
    teaser,
    createdAt: Date.now()
  }
  insightStore.set(id, item)
  queueSave()
  return item
}

/**
 * Retrieve an insight from the cache.
 * @param {string} id
 * @returns {object|null}
 */
function getInsight (id) {
  const item = insightStore.get(id)
  if (!item) return null
  if (Date.now() - item.createdAt > INSIGHT_TTL_MS) {
    insightStore.delete(id)
    queueSave()
    return null
  }
  return item
}

/**
 * Clear all cached insights (primarily for testing).
 */
function clearInsightStore () {
  insightStore.clear()
  if (saveTimeout) {
    clearTimeout(saveTimeout)
    saveTimeout = null
  }
  if (process.env.NODE_ENV === 'test' && fs.existsSync(CACHE_FILE)) {
    try {
      fs.unlinkSync(CACHE_FILE)
    } catch {}
  }
}

/**
 * Generates substantive topic insight using local or remote inference.
 * Evaluates whether the message and recent conversation warrant an insight before generating.
 * @param {import('discord.js').Message} message
 * @param {Array<object>} recentContext - Optional recent channel context messages
 * @param {string} serverNews - Optional recent headlines or announcements from related server channels
 * @returns {Promise<{ directAnswer: string, extendedSteps: string|null, teaser: string, insight: string }|null>}
 */
async function generateTopicInsight (message, recentContext = [], serverNews = '') {
  if (!message) return null

  const authorName = message.author?.username || 'User'
  const text = (message.content || '').trim()
  if (!text) return null

  const contextSnippet = Array.isArray(recentContext) && recentContext.length > 0
    ? recentContext.map(m => `${m.author?.username || 'User'}: ${m.content}`).join('\n')
    : `${authorName}: ${text}`

  const newsSection = serverNews && serverNews.trim()
    ? `\nRecent Related Server News / Announcements:\n${serverNews.trim()}\n`
    : ''

  const prompt = `You are Skynet, an expert AI assistant observing a Discord channel (#${message.channel?.name || 'channel'}).

Recent Chat Context:
${contextSnippet}
${newsSection}
Triggering Message from @${authorName}:
"${text}"

=== TASK: PROACTIVE TOPIC INSIGHT EVALUATION ===
Evaluate whether this message is asking a question, describing a bug or problem, or discussing a topic where factual context, documentation, or troubleshooting would be genuinely helpful and welcomed.

CORE PRINCIPLE: ASSUME ANOMALIES & SPECIFIC UNUSUAL CIRCUMSTANCES, NOT ROUTINE
- When a user asks about a schedule, downtime, server state, bug, or game/system behavior, DO NOT assume they want basic or textbook advice (e.g. reciting standard Tuesday resets, telling them to restart their router, or quoting beginner manuals). Community members usually already know the routine.
- If someone is asking, assume something UNUSUAL, off-schedule, or recent has happened or is currently happening (e.g. an off-cycle patch/build, emergency maintenance/hotfix, beta/PTR build, unexpected outage, or recent edge case).
- Directly target what is specifically happening right now, any deviations from the norm, off-cycle announcements, or active edge cases rather than boilerplate generic rules.

Evaluation Criteria:
1. If the message is casual chatter, agreement or acknowledgment (e.g. "yeah", "ok", "cool"), banter, rhetorical remarks, or does NOT ask a question or discuss a problem where timely context is helpful, respond strictly with NONE.
2. If responding with an insight would be intrusive, awkward, or unsolicited noise, respond strictly with NONE.
3. If the user asks a question that can be answered directly and concisely (under 280 characters)—such as addressing a specific off-cycle event, unusual schedule, or direct factual clarification:
   Provide "directAnswer" and set "extendedSteps": null.
4. Only if the question reports an issue or error requiring multi-step troubleshooting, provide a brief 1-2 sentence directAnswer (under 280 characters) highlighting the unusual root cause, and put the multi-step troubleshooting checklist in "extendedSteps" (under 900 characters).

If worth an insight, output STRICTLY a JSON object with this format:
{
  "directAnswer": "The concise direct answer or high-level summary to post into chat (under 280 characters).",
  "extendedSteps": "Optional: Detailed multi-step troubleshooting steps or checklist (under 900 characters), or null if directAnswer is sufficient."
}

Otherwise, output STRICTLY:
NONE`

  try {
    const res = await ollama.queryOllama(
      '/api/generate',
      {
        prompt,
        options: {
          temperature: 0.1,
          num_predict: 350
        }
      },
      0
    )

    const raw = res?.response || res?.message?.content || ''
    const trimmed = raw.trim()
    if (!trimmed || trimmed.toUpperCase() === 'NONE' || trimmed.toUpperCase().startsWith('NONE')) {
      return null
    }

    // Extract JSON block from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const repaired = jsonrepair(jsonMatch[0])
    const parsed = JSON.parse(repaired)

    if (parsed.worthInsight === false) return null

    const isModernAnswer = Boolean(parsed.directAnswer)
    let directAnswer = (parsed.directAnswer || '').trim()
    let extendedSteps = parsed.extendedSteps ? String(parsed.extendedSteps).trim() : null

    // Backward compatibility with legacy { teaser, insight } format
    if (!directAnswer && parsed.teaser && parsed.insight) {
      directAnswer = parsed.teaser.trim()
      extendedSteps = parsed.insight.trim()
    } else if (!directAnswer && parsed.insight) {
      if (parsed.insight.length <= 280) {
        directAnswer = parsed.insight.trim()
        extendedSteps = null
      } else {
        directAnswer = '💡 ' + parsed.insight.slice(0, 180).trim() + '...'
        extendedSteps = parsed.insight.trim()
      }
    }

    if (extendedSteps === 'null' || (extendedSteps && extendedSteps.length < 20)) {
      extendedSteps = null
    }

    if (!directAnswer || directAnswer.length < 5) return null

    return {
      directAnswer,
      extendedSteps,
      // For backward compatibility:
      teaser: directAnswer,
      insight: extendedSteps || directAnswer,
      buttonLabel: parsed.buttonLabel || (isModernAnswer ? 'View Troubleshooting Steps' : 'View Insight')
    }
  } catch (err) {
    logger.warn(`ProactiveInsight: generation failed: ${err.message}`)
    return null
  }
}

/**
 * Dispatches a concise direct answer or high-level summary with optional troubleshooting steps.
 * @param {import('discord.js').Message} message
 * @param {import('discord.js').Client} client
 * @param {Array<object>} recentContext - Optional recent channel context messages
 * @returns {Promise<object|null>}
 */
async function executeProactiveInsight (message, client, recentContext = null) {
  if (!message || !message.channel) return null

  try {
    let contextMessages = recentContext
    if ((!contextMessages || contextMessages.length === 0) && typeof message.channel.messages?.fetch === 'function') {
      try {
        const fetched = await message.channel.messages.fetch({ limit: 8 })
        contextMessages = Array.from(fetched.values()).reverse()
      } catch (e) {}
    }

    let serverNewsSnippet = ''
    if (message.guild?.channels?.cache) {
      try {
        const currentChannelName = (message.channel?.name || '').toLowerCase()
        const topicPrefix = currentChannelName.split('-')[0]

        const newsChannel = Array.from(message.guild.channels.cache.values()).find(c => {
          if (!c.isTextBased?.() || c.id === message.channel.id) return false
          const name = (c.name || '').toLowerCase()
          if (topicPrefix && topicPrefix.length > 2 && name.includes(topicPrefix) && (name.includes('news') || name.includes('update') || name.includes('announc'))) {
            return true
          }
          return name.includes('news') || name.includes('announcements') || name.includes('updates')
        })

        if (newsChannel && typeof newsChannel.messages?.fetch === 'function') {
          const newsFetched = await newsChannel.messages.fetch({ limit: 3 }).catch(() => null)
          if (newsFetched && newsFetched.size > 0) {
            const newsList = Array.from(newsFetched.values())
              .reverse()
              .map(m => `[#${newsChannel.name}] ${(m.content || '').slice(0, 200)}`)
              .filter(line => line.length > 10)
            if (newsList.length > 0) {
              serverNewsSnippet = newsList.join('\n')
            }
          }
        }
      } catch (err) {
        // Silently continue if guild channel inspection fails
      }
    }

    const result = await generateTopicInsight(message, contextMessages, serverNewsSnippet)
    if (!result || !result.directAnswer) {
      logger.info(`ProactiveInsight: Evaluator decided against insight for message ${message.id} in #${message.channel.name || 'channel'}.`)
      return null
    }

    let components = []
    let insightId = null

    if (result.extendedSteps) {
      insightId = crypto.randomUUID().slice(0, 8)
      storeInsight(insightId, result.extendedSteps, result.directAnswer)

      const label = result.buttonLabel || 'View Troubleshooting Steps'
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`insight:${insightId}`)
          .setLabel(label)
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🔧')
      )
      components = [row]
    }

    logger.info(
      `ProactiveInsight: Posting insight for message ${message.id} in #${message.channel.name || 'channel'}` +
      (result.extendedSteps ? ' (with troubleshooting steps button)' : ' (direct answer)')
    )

    const payload = {
      content: result.directAnswer,
      allowedMentions: { repliedUser: false }
    }
    if (components.length > 0) {
      payload.components = components
    }

    const replyMsg = await message.reply(payload).catch(async () => {
      // Fallback to channel.send if message.reply fails (e.g. original message was deleted)
      return await message.channel.send(payload)
    })

    return {
      insightId,
      directAnswer: result.directAnswer,
      extendedSteps: result.extendedSteps,
      messageId: replyMsg?.id
    }
  } catch (err) {
    logger.error(`ProactiveInsight: Execution error: ${err.message}`)
    return null
  }
}

/**
 * Handles clicks on the "insight:*" button and reveals the content ephemerally.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleInsightButton (interaction) {
  const insightId = (interaction.customId || '').replace(/^insight:/, '')
  const insight = getInsight(insightId)

  if (!insight) {
    await interaction.reply({
      content: '⚠️ This insight or troubleshooting guide has expired or is no longer available.',
      flags: [MessageFlags.Ephemeral]
    }).catch(() => {})
    return
  }

  await interaction.reply({
    content: insight.content,
    flags: [MessageFlags.Ephemeral]
  }).catch(err => {
    logger.error(`ProactiveInsight: Failed to reply to button interaction: ${err.message}`)
  })
}

module.exports = {
  INSIGHT_TTL_MS,
  CACHE_FILE,
  loadFromDisk,
  storeInsight,
  getInsight,
  clearInsightStore,
  generateTopicInsight,
  executeProactiveInsight,
  handleInsightButton
}
