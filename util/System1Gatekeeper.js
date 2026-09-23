const logger = require('../logger')
const { isProactiveChannelAllowed } = require('./config_manager')
const { isChannelInFlight } = require('./inFlightChannels')
const { selectProactiveEmoji, executeProactiveInterjection } = require('./chat/proactivePersonality')
const { executeProactiveInsight } = require('./chat/proactiveInsight')

function noul (instructions, criteria = null) {
  return {
    type: 'noul',
    instructions,
    criteria: criteria ?? null
  }
}

class VonClient {
  constructor (options = {}) {
    const envBase = typeof process !== 'undefined' ? process.env?.VON_BASE_URL || process.env?.TYPESAFE_BASE_URL : undefined
    this.baseURL = (options.baseURL || envBase || 'http://localhost:8000').replace(/\/$/, '')
    const envKey = typeof process !== 'undefined' ? process.env?.VON_API_KEY || process.env?.TYPESAFE_API_KEY : undefined
    this.apiKey = options.apiKey || envKey || undefined
    this.timeout = options.timeout ?? 30000
  }

  async systemOne ({ state, questions, model = 'von-1.1.0' }) {
    const url = `${this.baseURL}/v1/systemone`
    const headers = { 'Content-Type': 'application/json' }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }
    const payload = { model, state, questions }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)
    if (timer.unref) timer.unref()

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      })
      if (!res.ok) {
        const errText = await res.text()
        const err = new Error(`Von server error (${res.status}): ${errText}`)
        err.status = res.status
        throw err
      }
      return await res.json()
    } finally {
      clearTimeout(timer)
    }
  }
}

class System1Gatekeeper {
  constructor () {
    this.baseURL = process.env.VON_BASE_URL || 'http://127.0.0.1:8000'
    this.client = new VonClient({ baseURL: this.baseURL })

    // Cooldown configurations (in ms)
    this.reactionCooldownMs = parseInt(process.env.GATEKEEPER_REACTION_COOLDOWN_MS, 10) || 10 * 60 * 1000 // 10 minutes
    this.interjectCooldownMs = parseInt(process.env.GATEKEEPER_INTERJECT_COOLDOWN_MS, 10) || 60 * 60 * 1000 // 60 minutes
    this.insightCooldownMs = parseInt(process.env.GATEKEEPER_INSIGHT_COOLDOWN_MS, 10) || 30 * 60 * 1000 // 30 minutes

    // Probability thresholds (0.0 - 1.0)
    this.reactionThreshold = parseFloat(process.env.VON_REACTION_THRESHOLD) || 0.80
    this.interjectThreshold = parseFloat(process.env.VON_INTERJECT_THRESHOLD) || 0.80
    this.insightThreshold = parseFloat(process.env.VON_INSIGHT_THRESHOLD) || 0.80

    // In-memory cooldown tracking per channel ID
    this.lastReactionTimeByChannel = new Map()
    this.lastInterjectTimeByChannel = new Map()
    this.lastInsightTimeByChannel = new Map()

    this._hasLoggedOffline = false
  }

  /**
   * Reset cooldowns (primarily used for unit testing).
   */
  resetCooldowns () {
    this.lastReactionTimeByChannel.clear()
    this.lastInterjectTimeByChannel.clear()
    this.lastInsightTimeByChannel.clear()
  }

  /**
   * Check if a channel is on reaction cooldown.
   * @param {string} channelId
   * @returns {boolean}
   */
  isReactionOnCooldown (channelId) {
    const last = this.lastReactionTimeByChannel.get(channelId) || 0
    return Date.now() - last < this.reactionCooldownMs
  }

  /**
   * Check if a channel is on interjection cooldown.
   * @param {string} channelId
   * @returns {boolean}
   */
  isInterjectOnCooldown (channelId) {
    const last = this.lastInterjectTimeByChannel.get(channelId) || 0
    return Date.now() - last < this.interjectCooldownMs
  }

  /**
   * Check if a channel is on insight cooldown.
   * @param {string} channelId
   * @returns {boolean}
   */
  isInsightOnCooldown (channelId) {
    const last = this.lastInsightTimeByChannel.get(channelId) || 0
    return Date.now() - last < this.insightCooldownMs
  }

  /**
   * Fast in-memory filter to determine if a message should even be scored by Von.
   * @param {import('discord.js').Message} message
   * @param {string} botId
   * @returns {boolean} True if message should be evaluated
   */
  shouldEvaluate (message, botId) {
    if (!message || !message.author) return false
    if (message.author.bot) return false
    if (botId && message.author.id === botId) return false

    // Skip DMs or messages without guild
    if (!message.guildId || !message.guild) return false

    // Skip direct mentions or replies to the bot (handled by interactive chat)
    const isUserMention = Boolean(
      (botId && message.mentions?.has?.(botId, { ignoreEveryone: true, ignoreRoles: true })) ||
      (botId && (message.content?.includes(`<@${botId}>`) || message.content?.includes(`<@!${botId}>`)))
    )
    const isReplyToBot = Boolean(
      message.reference && message.mentions?.repliedUser?.id === botId
    )
    if (isUserMention || isReplyToBot) return false

    // Skip if channel is currently executing an interactive command
    if (isChannelInFlight(message.channel.id)) return false

    // Verify channel is enabled for proactive presence
    const channelName = message.channel.name || ''
    if (!isProactiveChannelAllowed(message.guildId, message.channel.id, channelName)) {
      return false
    }

    // Skip trivial or empty messages (< 4 chars)
    const text = (message.content || '').trim()
    if (text.length < 4) return false

    // If all cooldowns are active, no need to query System 1
    const reactionBlocked = this.isReactionOnCooldown(message.channel.id)
    const interjectBlocked = this.isInterjectOnCooldown(message.channel.id)
    const insightBlocked = this.isInsightOnCooldown(message.channel.id)
    if (reactionBlocked && interjectBlocked && insightBlocked) return false

    return true
  }

  /**
   * Evaluate an incoming message using the local Von System One model and dispatch if warranted.
   * @param {import('discord.js').Message} message
   * @param {import('discord.js').Client} discordClient
   * @param {object} database - Firebase database instance
   * @returns {Promise<object|null>} The evaluation result or null
   */
  async evaluateMessage (message, discordClient, database) {
    const botId = discordClient?.user?.id
    if (!this.shouldEvaluate(message, botId)) return null

    const channelId = message.channel.id
    const channelName = message.channel.name || 'channel'

    try {
      const start = Date.now()
      const res = await this.client.systemOne({
        state: message.content,
        questions: {
          reaction: noul('Is this message funny, shocking, hype, or notable enough to react to?'),
          interject: noul('Does this message explicitly address Skynet, ask Skynet a question, or clearly call on the bot to speak?'),
          insight: noul('Does this message ask a technical question, describe a bug or problem, or discuss a topic where factual context or troubleshooting would be helpful?')
        }
      })

      this._hasLoggedOffline = false
      const latencyMs = Date.now() - start
      const reactionProb = res?.answers?.reaction?.noul ?? 0
      const interjectProb = res?.answers?.interject?.noul ?? 0
      const insightProb = res?.answers?.insight?.noul ?? 0

      logger.info(
        `System1Gatekeeper: #${channelName} evaluated in ${latencyMs}ms ` +
        `[reaction: ${reactionProb.toFixed(2)}, interject: ${interjectProb.toFixed(2)}, insight: ${insightProb.toFixed(2)}]`
      )

      // Spoken interjections interrupt human conversation and must NEVER trigger on arbitrary banter
      // unless it contains an explicit question mark or mentions the bot/AI.
      const rawText = message.content || ''
      const hasQuestion = rawText.includes('?')
      const mentionsBot = /\b(skynet|bot|ai)\b/i.test(rawText)
      const canInterject = hasQuestion || mentionsBot

      // Priority 1: High-confidence Interjection (Conversational 1-line flavor)
      if (canInterject && interjectProb >= this.interjectThreshold && !this.isInterjectOnCooldown(channelId)) {
        this.lastInterjectTimeByChannel.set(channelId, Date.now())
        logger.info(
          `System1Gatekeeper: Interjection triggered in #${channelName} ` +
          `(score: ${interjectProb.toFixed(2)} >= ${this.interjectThreshold}) for "${message.content.slice(0, 50)}"`
        )
        // Execute asynchronously so gatekeeper returns immediately
        setImmediate(() => {
          Promise.resolve(executeProactiveInterjection(message, discordClient, database)).catch(err => {
            logger.error(`System1Gatekeeper: Proactive interjection error: ${err.message}`)
          })
        })
        return { action: 'interject', score: interjectProb, latencyMs }
      }

      // Priority 2: High-confidence Topic Insight (Helpful context with Ephemeral Button)
      if (insightProb >= this.insightThreshold && !this.isInsightOnCooldown(channelId)) {
        this.lastInsightTimeByChannel.set(channelId, Date.now())
        logger.info(
          `System1Gatekeeper: Insight triggered in #${channelName} ` +
          `(score: ${insightProb.toFixed(2)} >= ${this.insightThreshold}) for "${message.content.slice(0, 50)}"`
        )
        setImmediate(() => {
          Promise.resolve(executeProactiveInsight(message, discordClient)).catch(err => {
            logger.error(`System1Gatekeeper: Proactive insight error: ${err.message}`)
          })
        })
        return { action: 'insight', score: insightProb, latencyMs }
      }

      // Priority 3: High-confidence Reaction
      if (reactionProb >= this.reactionThreshold && !this.isReactionOnCooldown(channelId)) {
        this.lastReactionTimeByChannel.set(channelId, Date.now())
        logger.info(
          `System1Gatekeeper: Reaction triggered in #${channelName} ` +
          `(score: ${reactionProb.toFixed(2)} >= ${this.reactionThreshold}) for "${message.content.slice(0, 50)}"`
        )
        // Execute asynchronously so gatekeeper returns immediately
        setImmediate(() => {
          Promise.resolve(selectProactiveEmoji(message)).catch(err => {
            logger.error(`System1Gatekeeper: Proactive reaction error: ${err.message}`)
          })
        })
        return { action: 'react', score: reactionProb, latencyMs }
      }

      return { action: 'ignore', reactionProb, interjectProb, insightProb, latencyMs }
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        if (!this._hasLoggedOffline) {
          logger.warn(`System1Gatekeeper: Von server offline at ${this.baseURL}. Skipping proactive evaluation.`)
          this._hasLoggedOffline = true
        }
      } else {
        logger.warn(`System1Gatekeeper: Evaluation error: ${err.message}`)
      }
      return null
    }
  }
}

const gatekeeper = new System1Gatekeeper()
module.exports = gatekeeper
