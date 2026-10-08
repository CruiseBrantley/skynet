const logger = require('../logger')
const { isProactiveChannelAllowed } = require('./config_manager')
const { isChannelInFlight } = require('./inFlightChannels')
const { selectProactiveEmoji, executeProactiveInterjection } = require('./chat/proactivePersonality')
const { executeProactiveInsight } = require('./chat/proactiveInsight')

function noul (instructions, criteria = null) {
  const q = {
    type: 'noul',
    instructions
  }
  if (criteria && typeof criteria === 'object' && Object.keys(criteria).length > 0) {
    q.criteria = criteria
  }
  return q
}

class System1Client {
  constructor (options = {}) {
    const envBase = typeof process !== 'undefined' ? process.env?.SYSTEM1_BASE_URL || process.env?.VON_BASE_URL || process.env?.TYPESAFE_BASE_URL : undefined
    this.baseURL = (options.baseURL || envBase || 'http://localhost:11434').replace(/\/$/, '')
    const envKey = typeof process !== 'undefined' ? process.env?.SYSTEM1_API_KEY || process.env?.VON_API_KEY || process.env?.TYPESAFE_API_KEY : undefined
    this.apiKey = options.apiKey || envKey || undefined
    this.timeout = options.timeout ?? 30000
  }

  async systemOne ({ state, questions, model = process.env.SYSTEM1_MODEL || process.env.VON_MODEL || 'nimble', timeout }) {
    const url = `${this.baseURL}/v1/systemone`
    const headers = { 'Content-Type': 'application/json' }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }
    const payload = { model, state, questions }
    const timeoutMs = timeout ?? this.timeout
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
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
        const err = new Error(`System 1 server error (${res.status}): ${errText}`)
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
    this.baseURL = process.env.SYSTEM1_BASE_URL || process.env.VON_BASE_URL || 'http://127.0.0.1:11434'
    this.client = new System1Client({ baseURL: this.baseURL })

    // Cooldown configurations (in ms) - default to 0 (no artificial rate limits)
    this.reactionCooldownMs = parseInt(process.env.GATEKEEPER_REACTION_COOLDOWN_MS, 10) || 0
    this.interjectCooldownMs = parseInt(process.env.GATEKEEPER_INTERJECT_COOLDOWN_MS, 10) || 0
    this.insightCooldownMs = parseInt(process.env.GATEKEEPER_INSIGHT_COOLDOWN_MS, 10) || 0

    // High-confidence probability thresholds (0.0 - 1.0)
    this.reactionThreshold = parseFloat(process.env.SYSTEM1_REACTION_THRESHOLD || process.env.VON_REACTION_THRESHOLD) || 0.75
    this.interjectThreshold = parseFloat(process.env.SYSTEM1_INTERJECT_THRESHOLD || process.env.VON_INTERJECT_THRESHOLD) || 0.80
    this.insightThreshold = parseFloat(process.env.SYSTEM1_INSIGHT_THRESHOLD || process.env.VON_INSIGHT_THRESHOLD) || 0.85

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
   * Calculate effective reaction threshold for a channel.
   * If a reaction recently occurred, dynamically raises the threshold to reduce reaction
   * frequency while still allowing truly exceptional messages (> 0.92-0.95) to react.
   * Decay window is 3 minutes with up to +0.18 threshold boost immediately after a reaction.
   * @param {string} channelId
   * @returns {number}
   */
  getEffectiveReactionThreshold (channelId) {
    const base = this.reactionThreshold
    const last = this.lastReactionTimeByChannel.get(channelId) || 0
    const elapsed = Date.now() - last
    const decayWindowMs = 3 * 60 * 1000 // 3 minutes

    if (elapsed < decayWindowMs) {
      const penalty = 0.18 * (1 - (elapsed / decayWindowMs))
      return Math.min(0.95, base + penalty)
    }
    return base
  }

  /**
   * Check if a channel is on reaction cooldown.
   * @param {string} channelId
   * @returns {boolean}
   */
  isReactionOnCooldown (channelId) {
    if (this.reactionCooldownMs <= 0) return false
    const last = this.lastReactionTimeByChannel.get(channelId) || 0
    return Date.now() - last < this.reactionCooldownMs
  }

  /**
   * Check if a channel is on interjection cooldown.
   * @param {string} channelId
   * @returns {boolean}
   */
  isInterjectOnCooldown (channelId) {
    if (this.interjectCooldownMs <= 0) return false
    const last = this.lastInterjectTimeByChannel.get(channelId) || 0
    return Date.now() - last < this.interjectCooldownMs
  }

  /**
   * Check if a channel is on insight cooldown.
   * @param {string} channelId
   * @returns {boolean}
   */
  isInsightOnCooldown (channelId) {
    if (this.insightCooldownMs <= 0) return false
    const last = this.lastInsightTimeByChannel.get(channelId) || 0
    return Date.now() - last < this.insightCooldownMs
  }

  /**
   * Fast in-memory filter to determine if a message should even be scored by System 1.
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

    // Skip empty or whitespace-only messages
    const text = (message.content || '').trim()
    if (!text) return false

    // If all configured cooldowns are active, no need to query System 1
    const reactionBlocked = this.reactionCooldownMs > 0 && this.isReactionOnCooldown(message.channel.id)
    const interjectBlocked = this.interjectCooldownMs > 0 && this.isInterjectOnCooldown(message.channel.id)
    const insightBlocked = this.insightCooldownMs > 0 && this.isInsightOnCooldown(message.channel.id)
    if (reactionBlocked && interjectBlocked && insightBlocked) return false

    return true
  }

  /**
   * Helper to build conversational context string for System 1.
   * Uses cached channel messages to provide recent conversational history.
   * @param {import('discord.js').Message} message
   * @param {string} botId
   * @returns {string} Formatted context
   */
  buildEvaluationState (message, botId) {
    const rawContent = (message.content || '').trim()
    if (!message.channel?.messages?.cache || message.channel.messages.cache.size <= 1) {
      return rawContent
    }

    try {
      const recent = Array.from(message.channel.messages.cache.values())
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .slice(-5)

      if (recent.length > 1) {
        return recent.map(m => {
          const author = (botId && m.author?.id === botId) ? 'Skynet (bot)' : (m.author?.username || 'User')
          let content = (m.content || '').trim()
          // Truncate previous long messages so massive summaries don't drown out conversational intent
          if (m.id !== message.id && content.length > 300) {
            content = content.slice(0, 300) + '...'
          }
          return `[${author}]: ${content}`
        }).join('\n')
      }
    } catch {
      // Fallback to raw content if cache manipulation fails
    }

    return rawContent
  }

  /**
   * Evaluate an incoming message using the local System One model and dispatch if warranted.
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
      const state = this.buildEvaluationState(message, botId)
      const res = await this.client.systemOne({
        state,
        questions: {
          reaction: noul(
            'Is this message funny, shocking, hype, or notable enough to warrant an emoji reaction?',
            {
              true: 'The message is humorous, exciting, surprising, or notable enough to warrant an emoji.',
              false: 'The message is routine text, a direct command, or ordinary.'
            }
          ),
          interject: noul(
            'Does the message address Skynet, command Skynet, or request a response from Skynet?',
            {
              true: 'The user is talking directly to Skynet, answering Skynet, asking Skynet to do something, or requesting a response.',
              false: 'The user is talking to other users or not addressing Skynet.'
            }
          ),
          insight: noul(
            'Does this message ask a question, describe a problem, or present an opportunity where the bot can assist with timely, helpful information without being obtrusive?',
            {
              true: 'The user is seeking information or help that the bot can assist with in a timely, helpful way.',
              false: 'The user is not seeking assistance or the bot should not interrupt.'
            }
          )
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

      const triggeredActions = []

      // Priority 1: High-confidence Interjection (Talking directly to/about the bot or answering it)
      let interjected = false
      const effectiveInterjectThreshold = (message.content && /\bskynet\b/i.test(message.content))
        ? Math.min(this.interjectThreshold, 0.60)
        : this.interjectThreshold

      if (interjectProb >= effectiveInterjectThreshold && !this.isInterjectOnCooldown(channelId)) {
        this.lastInterjectTimeByChannel.set(channelId, Date.now())
        logger.info(
          `System1Gatekeeper: Interjection triggered in #${channelName} ` +
          `(score: ${interjectProb.toFixed(2)} >= ${this.interjectThreshold}) for "${message.content.slice(0, 50)}"`
        )
        interjected = true
        triggeredActions.push('interject')
        // Execute asynchronously so gatekeeper returns immediately
        setImmediate(() => {
          Promise.resolve(executeProactiveInterjection(message, discordClient, database)).catch(err => {
            logger.error(`System1Gatekeeper: Proactive interjection error: ${err.message}`)
          })
        })
      }

      // Priority 2: High-confidence Topic Insight (Timely, unobtrusive assistance)
      // Only triggered if not already interjecting with spoken text to avoid duplicate text replies
      if (!interjected && insightProb >= this.insightThreshold && !this.isInsightOnCooldown(channelId)) {
        this.lastInsightTimeByChannel.set(channelId, Date.now())
        logger.info(
          `System1Gatekeeper: Insight triggered in #${channelName} ` +
          `(score: ${insightProb.toFixed(2)} >= ${this.insightThreshold}) for "${message.content.slice(0, 50)}"`
        )
        triggeredActions.push('insight')
        setImmediate(() => {
          Promise.resolve(executeProactiveInsight(message, discordClient)).catch(err => {
            logger.error(`System1Gatekeeper: Proactive insight error: ${err.message}`)
          })
        })
      }

      // Priority 3: High-confidence Reaction (non-intrusive emoji; can trigger alongside interject/insight or alone)
      const effectiveReactionThreshold = this.getEffectiveReactionThreshold(channelId)
      if (reactionProb >= effectiveReactionThreshold && !this.isReactionOnCooldown(channelId)) {
        this.lastReactionTimeByChannel.set(channelId, Date.now())
        logger.info(
          `System1Gatekeeper: Reaction triggered in #${channelName} ` +
          `(score: ${reactionProb.toFixed(2)} >= ${effectiveReactionThreshold.toFixed(2)}) for "${message.content.slice(0, 50)}"`
        )
        triggeredActions.push('react')
        // Execute asynchronously so gatekeeper returns immediately
        setImmediate(() => {
          Promise.resolve(selectProactiveEmoji(message)).catch(err => {
            logger.error(`System1Gatekeeper: Proactive reaction error: ${err.message}`)
          })
        })
      }

      if (triggeredActions.length === 0) {
        return { action: 'ignore', reactionProb, interjectProb, insightProb, latencyMs }
      }

      const primaryAction = triggeredActions.length === 1 ? triggeredActions[0] : triggeredActions.join('+')
      const primaryScore = triggeredActions[0] === 'react' ? reactionProb : (triggeredActions[0] === 'interject' ? interjectProb : insightProb)

      return {
        action: primaryAction,
        actions: triggeredActions,
        score: primaryScore,
        reactionProb,
        interjectProb,
        insightProb,
        latencyMs
      }
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        if (!this._hasLoggedOffline) {
          logger.warn(`System1Gatekeeper: Decision server offline at ${this.baseURL}. Skipping proactive evaluation.`)
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
gatekeeper.System1Client = System1Client
gatekeeper.VonClient = System1Client
gatekeeper.noul = noul
module.exports = gatekeeper
