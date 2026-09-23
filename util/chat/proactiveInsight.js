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
 * @param {import('discord.js').Message} message
 * @returns {Promise<{ teaser: string, insight: string }|null>}
 */
async function generateTopicInsight (message) {
  const authorName = message.author?.username || 'User'
  const text = message.content || ''

  const prompt = `You are Skynet, an expert AI assistant observing a Discord channel.
A user asked or mentioned: "${authorName}: ${text}"

Your task is to provide a genuinely helpful, factual insight, explanation, documentation reference, or troubleshooting tip on the topic.
DO NOT provide generic greetings, filler, or fluff. Provide high-density, accurate information.

Respond strictly in the following JSON format:
{
  "teaser": "A 1-sentence hook under 80 characters for chat (e.g. '💡 I found some relevant context regarding this error.')",
  "insight": "The substantive, detailed explanation or troubleshooting steps (under 900 characters). Format cleanly with markdown."
}`

  try {
    const res = await ollama.queryOllama(
      '/api/generate',
      {
        prompt,
        options: {
          temperature: 0.2,
          num_predict: 350
        }
      },
      0
    )

    const raw = res?.response || ''
    // Extract JSON block from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const repaired = jsonrepair(jsonMatch[0])
    const parsed = JSON.parse(repaired)

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
 * @returns {Promise<object|null>}
 */
async function executeProactiveInsight (message, client) {
  if (!message || !message.channel) return null

  try {
    const result = await generateTopicInsight(message)
    if (!result || !result.insight) return null

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
