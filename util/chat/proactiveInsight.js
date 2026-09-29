const crypto = require('crypto')
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js')
const { jsonrepair } = require('jsonrepair')
const logger = require('../../logger')
const ollama = require('../ollama')

// In-memory cache for generated topic insights (TTL: 2 hours)
const INSIGHT_TTL_MS = 2 * 60 * 60 * 1000
const insightStore = new Map()

// Periodic sweep to evict expired insights
const sweepTimer = setInterval(() => {
  const now = Date.now()
  for (const [id, item] of insightStore.entries()) {
    if (now - item.createdAt > INSIGHT_TTL_MS) {
      insightStore.delete(id)
    }
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
    return null
  }
  return item
}

/**
 * Clear all cached insights (primarily for testing).
 */
function clearInsightStore () {
  insightStore.clear()
}

/**
 * Generates substantive topic insight using local or remote inference.
 * Evaluates whether the message and recent conversation warrant an insight before generating.
 * @param {import('discord.js').Message} message
 * @param {Array<object>} recentContext - Optional recent channel context messages
 * @returns {Promise<{ teaser: string, insight: string }|null>}
 */
async function generateTopicInsight (message, recentContext = []) {
  if (!message) return null

  const authorName = message.author?.username || 'User'
  const text = (message.content || '').trim()
  if (!text) return null

  const contextSnippet = Array.isArray(recentContext) && recentContext.length > 0
    ? recentContext.map(m => `${m.author?.username || 'User'}: ${m.content}`).join('\n')
    : `${authorName}: ${text}`

  const prompt = `You are Skynet, an expert AI assistant observing a Discord channel (#${message.channel?.name || 'channel'}).

Recent Chat Context:
${contextSnippet}

Triggering Message from @${authorName}:
"${text}"

=== TASK: PROACTIVE TOPIC INSIGHT EVALUATION ===
First, evaluate whether this message is actually asking a technical question, describing a bug or problem, or discussing a topic where factual context, documentation, or troubleshooting would be genuinely helpful and welcomed.

Evaluation Criteria:
1. If the message is casual chatter, agreement or acknowledgment (e.g. "yeah", "ok", "cool"), banter, rhetorical remarks, or does NOT ask a question or discuss a problem where technical context is helpful, respond strictly with NONE.
2. If responding with an insight would be intrusive, awkward, or unsolicited noise, respond strictly with NONE.
3. Only if the message asks a technical question, reports a problem/bug, or discusses a topic where a substantive factual tip would be genuinely helpful, provide the insight.

If worth an insight, output STRICTLY a JSON object with this format:
{
  "teaser": "A 1-sentence hook under 80 characters for chat (e.g. '💡 I found some relevant context regarding this error.')",
  "insight": "The substantive, detailed explanation or troubleshooting steps (under 900 characters). Format cleanly with markdown."
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

    const teaser = (parsed.teaser || '').trim()
    const insight = (parsed.insight || '').trim()

    if (!insight || insight.length < 20) return null

    return {
      teaser: teaser || '💡 Skynet has relevant context on this topic.',
      insight
    }
  } catch (err) {
    logger.warn(`ProactiveInsight: generation failed: ${err.message}`)
    return null
  }
}

/**
 * Dispatches an unobtrusive insight teaser with a View Insight button.
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

    const result = await generateTopicInsight(message, contextMessages)
    if (!result || !result.insight) {
      logger.info(`ProactiveInsight: Evaluator decided against insight for message ${message.id} in #${message.channel.name || 'channel'}.`)
      return null
    }

    const insightId = crypto.randomUUID().slice(0, 8)
    storeInsight(insightId, result.insight, result.teaser)

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`insight:${insightId}`)
        .setLabel('View Insight')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('💡')
    )

    logger.info(`ProactiveInsight: Posting insight teaser for message ${message.id} in #${message.channel.name || 'channel'}`)

    const replyMsg = await message.reply({
      content: result.teaser,
      components: [row],
      allowedMentions: { repliedUser: false }
    }).catch(async () => {
      // Fallback to channel.send if message.reply fails (e.g. original message was deleted)
      return await message.channel.send({
        content: result.teaser,
        components: [row]
      })
    })

    return {
      insightId,
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
      content: '⚠️ This insight has expired or is no longer available.',
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
  storeInsight,
  getInsight,
  clearInsightStore,
  generateTopicInsight,
  executeProactiveInsight,
  handleInsightButton
}
