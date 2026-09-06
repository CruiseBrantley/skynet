const logger = require('../logger')
const agentMemory = require('./AgentMemory')
const agentScheduler = require('./AgentScheduler')
const { jsonrepair } = require('jsonrepair')
const { isChannelInFlight, markChannelInFlight, clearChannelInFlight } = require('./inFlightChannels')

// Max recursion depth per tick — prevents the model from chaining tool calls indefinitely
const MAX_LOOP_DEPTH = 5

// Ring buffer size for recent agent actions (for the agent's own context)
const MAX_RECENT_ACTIONS = 20

/**
 * Autonomous background agent loop.
 * Wakes on a configurable interval, evaluates the current state using local/remote Ollama,
 * and executes lightweight tool calls (memory, scheduling) as needed.
 *
 * Design constraints:
 * - NEVER calls Gemini — all inference via queryLocalOrRemote()
 * - Backs off if a tick is already running (no concurrent evaluations)
 * - Depth counter prevents runaway recursive tool chains
 * - Unknown or unsupported commands are silently ignored, never re-tried
 */
class AgentLoop {
  constructor () {
    this._interval = null
    this._isRunning = false
    this._lastRunAt = null
    this._recentActions = [] // Ring buffer of recent decisions/actions
    this._bot = null // Discord client reference, injected on start()
    this._tickCount = 0 // Total evaluations run
  }

  /**
       * Start the loop. Safe to call multiple times — won't create duplicate intervals.
       * @param {import('discord.js').Client} bot - The Discord client.
       * @param {number} intervalMs - Milliseconds between ticks. Default: 5 minutes.
       */
  start (bot, intervalMs = 5 * 60_000) {
    if (this._interval) {
      logger.info('AgentLoop: Already running — ignoring duplicate start().')
      return
    }
    this._bot = bot
    logger.info(`AgentLoop: Starting background evaluation loop (interval: ${intervalMs / 1000}s).`)

    // First tick fires after one full interval — let the bot finish initializing first.
    this._interval = setInterval(() => { this._tick() }, intervalMs)
    if (this._interval.unref) this._interval.unref()
  }

  /**
       * Stop the loop gracefully.
       */
  stop () {
    if (this._interval) {
      clearInterval(this._interval)
      this._interval = null
      logger.info('AgentLoop: Stopped.')
    }
  }

  /**
       * Trigger a manual evaluation immediately (e.g. for testing or external triggers).
       */
  async runOnce () {
    return this._tick()
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  async _tick () {
    if (this._isRunning) {
      logger.info('AgentLoop: Skipping tick — previous evaluation still in progress.')
      return
    }
    this._isRunning = true
    this._tickCount++
    logger.info(`AgentLoop: Tick #${this._tickCount} started.`)
    try {
      // 1. Evaluate internal state (maintenance, schedules, etc.)
      await this._evaluate(0)

      // 2. Periodic Twitch Webhook & Ingress Health Check (Every ~6 hours / 72 ticks)
      if (this._tickCount % 72 === 0) {
        try {
          const { checkTwitchHealth } = require('../server/server')
          await checkTwitchHealth(this._getDiscordClient())
        } catch (twitchErr) {
          logger.warn(`AgentLoop: Periodic Twitch health check error: ${twitchErr.message}`)
        }
      }

      // 3. Proactive "Interjection" check for whitelisted guilds
      await this._checkProactiveGuilds()
    } catch (err) {
      logger.error(`AgentLoop: Uncaught exception in tick: ${err.stack || err.message}`)
    } finally {
      this._isRunning = false
      this._lastRunAt = Date.now()
      logger.info(`AgentLoop: Tick #${this._tickCount} complete.`)
    }
  }

  _getDiscordClient () {
    if (!this._bot) return null
    if (this._bot.guilds && this._bot.guilds.cache) return this._bot
    if (this._bot.client && this._bot.client.guilds) return this._bot.client
    if (typeof this._bot.getClient === 'function') {
      const adapter = this._bot.getClient('discord')
      if (adapter) return adapter.client || adapter
    }
    return this._bot
  }

  /**
       * Iterate through all whitelisted guilds and decide if we should chime in.
       */
  async _checkProactiveGuilds () {
    const discordClient = this._getDiscordClient()
    if (!discordClient?.guilds?.cache) {
      logger.warn('AgentLoop: _checkProactiveGuilds — bot.guilds.cache unavailable, skipping.')
      return
    }

    // Fetch settings from Firebase
    const database = require('../firebase-login')()
    if (!database) return

    const snapshot = await database.ref('guild_settings').once('value')
    if (!snapshot.exists()) return
    const guildSettings = snapshot.val()

    const { isProactiveChannelAllowed } = require('./config_manager')

    for (const guildId in guildSettings) {
      const settings = guildSettings[guildId] || {}
      const textEnabled = settings.proactive_text_enabled ?? settings.agent_enabled ?? false
      const emojiEnabled = settings.proactive_emoji_enabled ?? settings.agent_enabled ?? false
      if (!textEnabled && !emojiEnabled) continue

      const guild = discordClient?.guilds?.cache?.get(guildId)
      if (!guild) continue

      const channels = await guild.channels.fetch()
      const textChannels = channels.filter(c =>
        c.isTextBased() && !c.isThread() && c.viewable &&
        c.permissionsFor(discordClient.user).has(['SendMessages', 'ReadMessageHistory']) &&
        c.lastMessageId &&
        isProactiveChannelAllowed(guildId, c.id, c.name)
      )

      // Pick the 3 channels with the most recent activity.
      // Discord snowflake IDs are time-ordered, so a simple string comparison gives us recency.
      const topChannels = [...textChannels.values()]
        .sort((a, b) => (a.lastMessageId > b.lastMessageId ? -1 : 1))
        .slice(0, 3)

      for (const channel of topChannels) {
        await this._evaluateProactivePresence(channel, guildId, settings)
      }
    }
  }

  async _evaluateProactivePresence (channel, guildId, settings = {}) {
    if (isChannelInFlight(channel.id)) {
      logger.info(`AgentLoop: skipping #${channel.name} — command currently in-flight in channel.`)
      return
    }

    markChannelInFlight(channel.id)
    logger.info(`AgentLoop: Evaluating proactive presence for #${channel.name} in ${guildId}...`)

    try {
      // Peek at the last 50 messages
      const messages = await channel.messages.fetch({ limit: 50 })
      if (messages.size < 3) return // Too quiet

      // RECENCY CHECK: Only evaluate if the conversation is still "alive" (last message within 15 mins)
      const lastMessage = messages.first()
      const botId = this._getDiscordClient()?.user?.id

      // BOT SELF-TALK PREVENTION: Never evaluate or interject if the last message was from me.
      // We wait for humans to provide fresh input before chiming in again.
      if (lastMessage.author.id === botId) {
        logger.info(`AgentLoop: skipping #${channel.name} — last message was from me.`)
        return
      }

      const fifteenMinsAgo = Date.now() - 15 * 60 * 1000
      if (lastMessage.createdAt.getTime() < fifteenMinsAgo) {
        logger.info(`AgentLoop: skipping #${channel.name} — conversation is stale.`)
        return
      }

      // MESSAGE ID TRACKING: Skip if we've already evaluated this exact conversation snapshot.
      const lastMsgKey = `proactive.last_msg.${channel.id}`
      const lastSeenMsgId = agentMemory.get(lastMsgKey, guildId)
      if (lastSeenMsgId && lastSeenMsgId === lastMessage.id) {
        logger.info(`AgentLoop: skipping #${channel.name} — no new messages since last evaluation.`)
        return
      }

      // Always record the newest message ID we're evaluating right at the start of evaluation
      agentMemory.set(lastMsgKey, lastMessage.id, 15 / (60 * 24), guildId)

      const { formatMessagesForContext } = require('./chat/contextHelper')
      const history = await formatMessagesForContext(messages, botId)

      const conversationContext = history.map(m => m.content).join('\n')
      const now = new Date().toLocaleString()
      const memorySummary = agentMemory.getSummary(guildId, 800) || 'None'

      const guild = channel.guild
      const rawChannels = await guild.channels.fetch().catch(() => null)
      const activeChannelsList = rawChannels
        ? [...rawChannels.values()]
            .filter(c => c.isTextBased())
            .map(c => `  - #${c.name} (ID: "${c.id}")`)
            .join('\n')
        : `  - #${channel.name} (ID: "${channel.id}")`

      const customEmojisList = [...guild.emojis.cache.values()]
        .map(e => `  - :${e.name}: -> <:${e.name}:${e.id}> (Reaction ID: "${e.id}")`)
        .join('\n') || '  None'

      const { getBasePrompt } = require('./systemPrompt')
      const prompt = `${getBasePrompt()}

=== AUTONOMOUS PROACTIVE MODE ===
You are currently observing a conversation in #${channel.name}.
Current time: ${now}

[AVAILABLE GUILD RESOURCES]
Text Channels on this server:
${activeChannelsList}

Custom Emojis on this server:
${customEmojisList}

[LONG-TERM MEMORY & ACTIVE RULES]
${memorySummary}

[CONVERSATION CONTENT]
${conversationContext}

Your goal is to decide if you should PROACTIVELY interact (send a suggestion/reply, react with an emoji, or execute/schedule background commands).

You MUST respond with a single valid JSON object containing your reasoning and planned actions. Do not output any other text, markdown formatting, or prefix.

Response JSON Schema:
{
  "reasoning": "A one-sentence explanation of why we are taking (or not taking) action.",
  "interject": {
    "message": "The text content of your suggestion or reply (optional if gif is provided).",
    "replyToId": "The message ID to reply to directly, or null to post to the channel.",
    "gif": "A search query to attach a reaction GIF (optional, e.g. 'excited', 'facepalm', 'anime dance')."
  },
  "reactions": [
    {
      "messageId": "The message ID to react to.",
      "emoji": "The emoji character."
    }
  ],
  "commands": [
    {
      "command": "remember",
      "key": "string",
      "value": "string",
      "ttl_days": number
    }
  ]
}

Available Commands for the "commands" array:
1. remember: Save a fact or rule.
   Schema: {"command": "remember", "key": "string (e.g. 'server.rules')", "value": "string/object", "ttl_days": number (use -1 for permanent, default 30)}
2. forget: Delete a saved memory.
   Schema: {"command": "forget", "key": "string"}
3. recall: Retrieve a saved memory.
   Schema: {"command": "recall", "key": "string"}
4. recall_keys: Find keys by prefix.
   Schema: {"command": "recall_keys", "prefix": "string"}
5. schedule: Schedule a task to fire later.
   Schema: {"command": "schedule", "message": "string (the task action description)", "when": "string (delay format e.g. 'in 2 hours', 'in 15 minutes', 'tomorrow at 9am')", "repeat": "string (optional e.g. 'daily', 'weekly')", "channelId": "string (optional)", "userId": "string (optional)"}
6. cancel_task: Cancel a scheduled task by ID.
   Schema: {"command": "cancel_task", "id": "string"}

Thresholds & Rules:
- INTERJECT (ULTRA-STRICT SILENCE MANDATE): Default to SILENCE ("interject": null).
- NEVER interject for small talk, casual jokes, conversational filler, or to rephrase/summarize what users just said.
- ONLY interject if there is a specific, unanswered technical, coding, or factual question that nobody in the channel has resolved, or if someone explicitly requests bot assistance.
- Keep any interjection under 2 sentences, direct, and focused strictly on high substance. No circular commentary.
- If not interjecting, set "interject" to null.
- PROACTIVE GIFS: Use reaction GIFs sparingly via the "gif" field ONLY when directly relevant or truly funny. Never send low-quality or irrelevant GIFs.
- REACT (STRICT): Only react to messages that are exceptionally funny, highly notable, or when a reaction adds genuine value or emphasis. Do not react to standard conversational filler. If not reacting, set "reactions" to []. You can react with standard Unicode emojis or use any custom emoji ID (Reaction ID) listed under [AVAILABLE GUILD RESOURCES].
- REMEMBER (LENIENT): If you notice useful information, preferences, facts, or context, save it. When updating existing info, use the same key.
- If nothing is needed, respond with:
  {"reasoning": "No action needed.", "interject": null, "reactions": [], "commands": []}

ULTRA-STRICT SILENCE RULE: Most channel evaluations MUST result in no interjection ("interject": null). Remain completely silent unless you have an essential, high-impact, direct contribution. Set "interject" to null if you are unsure.
MEMORY COMPLIANCE: Treat all entries in LONG-TERM MEMORY & ACTIVE RULES as absolute factual context or active behavioral instructions. If a 'behavior.*' or 'server.*' key specifies a specific style, emoji replacement, or rule, you MUST adhere to it strictly. If reacting, and an active rule specifies a custom emoji replacement, use that custom emoji instead of the standard ones.

Standard Emojis: 👍, 😂, 🔥, ✨, ❤️, 💯, 🤔, 👎, 🖕, 🤖, 💀, 😭, 🦴, 💀, 💨, 💩, 🗿, 🙃, 😶‍🌫️, 🍌, 🧍.`

      const { queryLocalOrRemote } = require('./ollama')
      const result = await queryLocalOrRemote('/api/chat', {
        messages: [{ role: 'system', content: prompt }],
        options: { temperature: 0.05 }
      })

      const content = result?.message?.content?.trim() || ''

      // Always record the newest message ID we've evaluated, regardless of outcome.
      agentMemory.set(lastMsgKey, lastMessage.id, 15 / (60 * 24), guildId)

      let parsed = null
      try {
        let jsonStr = content
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```[a-zA-Z]*\s*/, '')
          jsonStr = jsonStr.replace(/\s*```$/, '')
          jsonStr = jsonStr.trim()
        }
        const startIdx = jsonStr.indexOf('{')
        const endIdx = jsonStr.lastIndexOf('}')
        if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
          const jsonSubstring = jsonStr.substring(startIdx, endIdx + 1)
          parsed = JSON.parse(jsonrepair(jsonSubstring))
        }
      } catch (e) {
        logger.warn(`AgentLoop: Failed to parse structured JSON response: ${e.message}. Raw content was: "${content.substring(0, 200)}"`)
      }

      if (parsed && typeof parsed === 'object') {
        logger.info(`AgentLoop: Processed proactive decision. Reasoning: "${parsed.reasoning || 'None'}"`)

        // Handle Interjection with channel cooldown (1 hour minimum between autonomous chatter)
        const textEnabled = settings.proactive_text_enabled ?? settings.agent_enabled ?? true
        const lastInterjectKey = `proactive.last_interject.${channel.id}`
        const lastInterjectTime = agentMemory.get(lastInterjectKey, guildId)
        const isCooldownActive = lastInterjectTime && (Date.now() - Number(lastInterjectTime) < 60 * 60 * 1000)

        if (parsed.interject && (parsed.interject.message || parsed.interject.gif) && textEnabled && !isCooldownActive) {
          agentMemory.set(lastInterjectKey, String(Date.now()), 1, guildId)
          let intercom = parsed.interject.message || ''
          const replyToId = parsed.interject.replyToId
          const gifQuery = parsed.interject.gif

          const { BOILERPLATE_SCRUB_REGEX, ID_SCRUB_REGEX } = require('./chat/constants')
          intercom = intercom
            .replace(BOILERPLATE_SCRUB_REGEX, '')
            .replace(ID_SCRUB_REGEX, '')
            .trim()

          let gifUrl = null
          if (gifQuery) {
            try {
              const gifService = require('./chat/gifService')
              gifUrl = await gifService.getGif(gifQuery, guildId)
            } catch (err) {
              logger.error(`AgentLoop: Proactive GIF lookup failed: ${err.message}`)
            }
          }

          const { EmbedBuilder } = require('discord.js')
          let embed = null
          if (gifUrl) {
            embed = new EmbedBuilder().setImage(gifUrl).setColor(0x3498db)
          }

          if (intercom || embed) {
            const payload = {}
            if (intercom) payload.content = intercom
            if (embed) payload.embeds = [embed]

            if (replyToId) {
              const targetMsg = await channel.messages.fetch(replyToId).catch(() => null)
              if (targetMsg) {
                await targetMsg.reply(payload)
                logger.info(`AgentLoop: Replied to msg ${replyToId} in #${channel.name}: "${(intercom || 'GIF').substring(0, 50)}..."`)
              } else {
                await channel.send(payload)
              }
            } else {
              await channel.send(payload)
              logger.info(`AgentLoop: Interjected in #${channel.name}: "${(intercom || 'GIF').substring(0, 50)}..."`)
            }
          }
        }

        // Handle Reactions
        const emojiEnabled = settings.proactive_emoji_enabled ?? settings.agent_enabled ?? true
        if (parsed.reactions && Array.isArray(parsed.reactions) && emojiEnabled) {
          for (const react of parsed.reactions) {
            if (react.messageId && react.emoji) {
              const message = await channel.messages.fetch(react.messageId).catch(() => null)
              if (message) {
                const existing = message.reactions.cache.get(react.emoji) ||
                                  message.reactions.cache.find(r => r.emoji.name === react.emoji || r.emoji.id === react.emoji)
                if (!existing || !existing.me) {
                  await message.react(react.emoji).catch(() => {})
                  logger.info(`AgentLoop: Proactively reacted with ${react.emoji} to message ${react.messageId}.`)
                }
              }
            }
          }
        }

        // Handle Commands
        if (parsed.commands && Array.isArray(parsed.commands)) {
          for (const cmdData of parsed.commands) {
            await this._executeCommand(cmdData, guildId)
          }
        }
      }
    } catch (err) {
      logger.error(`AgentLoop proactive presence evaluation error: ${err.message}`)
    } finally {
      clearChannelInFlight(channel.id)
    }
  }

  async _evaluate (loopDepth) {
    if (loopDepth > MAX_LOOP_DEPTH) {
      logger.warn(`AgentLoop: MAX_LOOP_DEPTH (${MAX_LOOP_DEPTH}) reached — stopping recursion.`)
      return
    }

    // ── Build context ──────────────────────────────────────────────────────
    const now = new Date().toLocaleString('en-US', { timeZoneName: 'short' })
    const memorySummary = agentMemory.getSummary(null, 800) || 'Empty'
    const tasks = agentScheduler.getAll()
    const recentActions = this._recentActions.slice(-5).join('\n') || 'None'

    const taskList = tasks.length > 0
      ? tasks.map(t =>
        `  - [${t.id}] "${t.description.substring(0, 80)}" → ${new Date(t.scheduledAt).toLocaleString()}${t.repeat ? ` (repeats ${t.repeat})` : ''} | target: ${t.channelId}`
      ).join('\n')
      : '  None'

    let hostMetricsSummary = 'Normal'
    try {
      const os = require('os')
      const totalMem = os.totalmem()
      const freeMem = os.freemem()
      const usedMemPercent = (((totalMem - freeMem) / totalMem) * 100).toFixed(1)
      const loadAvg = os.loadavg().map(l => l.toFixed(2)).join(', ')
      const processMemMb = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1)
      hostMetricsSummary = `Host RAM Usage: ${usedMemPercent}% | CPU Load: [${loadAvg}] | Bot RSS: ${processMemMb} MB`
    } catch (_) {}

    let telemetrySummary = 'No recent command errors.'
    try {
      const telemetry = require('./telemetry')
      const errors = telemetry.getRecentLogs({ limit: 6, status: 'error' })
      if (errors && errors.length > 0) {
        telemetrySummary = errors.map(e => `  - [${e.timestamp}] ${e.type} "${e.commandName}": ${e.error || 'Failed'}`).join('\n')
      }
    } catch (_) {}

    let triggersSummary = 'No active watchdog triggers.'
    try {
      const triggerEngine = require('./TriggerEngine')
      const trigs = triggerEngine.listTriggers()
      if (trigs && trigs.length > 0) {
        triggersSummary = trigs.map(t => `  - [${t.id}] ${t.conditionType} (${t.target || 'system'}, threshold: ${t.threshold}, status: ${t.enabled !== false ? 'ENABLED' : 'DISABLED'}) -> ${t.actionType}`).join('\n')
      }
    } catch (_) {}

    let pendingRepairsSummary = 'No pending code repairs.'
    try {
      const selfHealing = require('./chat/SelfHealingEngine')
      const proposals = selfHealing.getPendingProposals()
      if (proposals && proposals.length > 0) {
        pendingRepairsSummary = proposals.map(p => `  - [${p.proposalId}] ${p.targetType === 'slash' ? '/' : ''}${p.name}: Error: "${String(p.error).substring(0, 60)}" (Awaiting owner approval)`).join('\n')
      }
    } catch (_) {}

    let recentFixesSummary = 'None'
    try {
      const allMem = agentMemory.getAll(null)
      const fixKeys = Object.keys(allMem).filter(k => k.startsWith('self_improvement.fixes.'))
      if (fixKeys.length > 0) {
        recentFixesSummary = fixKeys.map(k => {
          const name = k.replace('self_improvement.fixes.', '')
          const fix = allMem[k]
          const fixObj = typeof fix === 'string' ? JSON.parse(fix) : fix
          return `  - "${name}" fixed at ${fixObj.fixedAt || 'recently'}: ${fixObj.reasoning ? fixObj.reasoning.substring(0, 60) : 'patched'}`
        }).join('\n')
      }
    } catch (_) {}

    const actionExecutor = require('./ActionExecutor')
    const actionList = actionExecutor.listActions()
      .map(a => `  - ${a.name}: ${a.description}`)
      .join('\n') || '  None'

    const systemPrompt = `You are Skynet's autonomous background daemon agent.
Current time: ${now}

Your objective is to evaluate system health, active triggers, recent errors, and scheduled workflows to decide if any PROACTIVE or REMEDIAL action is needed.

[SYSTEM HEALTH & HOST METRICS]
${hostMetricsSummary}

[RECENT COMMAND & ACTION ERRORS]
${telemetrySummary}

[ACTIVE WATCHDOG TRIGGERS]
${triggersSummary}

[PENDING SELF-HEALING REPAIRS AWAITING APPROVAL]
${pendingRepairsSummary}

[RECENT AUTOMATED CODE FIXES]
${recentFixesSummary}

[LONG-TERM MEMORY]
${memorySummary}

[SCHEDULED TASKS]
${taskList}

[RECENT AGENT ACTIONS]
${recentActions}

[AVAILABLE ACTIONS & REMEDIATION TOOLS]
${actionList}

Rules:
- If all systems are healthy and no maintenance, remediation, or task scheduling is needed, respond with exactly: NOOP
- If you notice repetitive errors, misconfigured triggers, or system issues, proactively remediate using available actions (e.g. manage_triggers, trigger_self_healing, modify_action, remember, schedule).
- DO NOT delete or overwrite actions that currently have an active proposal in [PENDING SELF-HEALING REPAIRS].
- Format: <<<RUN_COMMAND: {"command": "...", ...}>>>
- DO NOT attempt to search the web, play music, or generate images speculatively.
- MEMORY UPDATE RULE: When storing information, check the LONG-TERM MEMORY section first. If you see an existing key that relates to what you're about to remember, use the SAME key with the updated value instead of creating a new one.

Available Core Commands:
- manage_triggers: Enable, disable, create, or delete watchdog triggers.
  Schema: <<<RUN_COMMAND: {"command": "manage_triggers", "action": "disable", "trigger_id": "host_ram"}>>>
- trigger_self_healing: Formulate a code repair proposal for a broken command or action.
  Schema: <<<RUN_COMMAND: {"command": "trigger_self_healing", "target_type": "action", "name": "action_name", "error": "details"}>>>
- remember / forget / recall / recall_keys: Manage key-value long-term memory.
- schedule / cancel_task: Manage timed background jobs.
- create_action / modify_action / delete_action: Manage dynamic Discord actions.

After your tool call, briefly explain WHY (one sentence). Example:
<<<RUN_COMMAND: {"command": "remember", "key": "server.last_health_check", "value": "2026-08-24", "ttl_days": 7}>>>
Reason: Recording health check timestamp for diagnostics.`

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Evaluate system state, errors, and triggers. Remediate if necessary, otherwise output NOOP.' }
    ]

    logger.info(`AgentLoop: Querying Ollama for evaluation (depth: ${loopDepth})...`)
    let result
    try {
      const { queryLocalOrRemote } = require('./ollama')
      result = await queryLocalOrRemote('/api/chat', {
        messages,
        options: {
          num_ctx: 8192,
          temperature: 0.3
        }
      })
    } catch (err) {
      logger.error(`AgentLoop: Ollama query failed: ${err.message}`)
      return
    }

    const content = result?.message?.content?.trim() || ''
    logger.info(`AgentLoop: Response (first 120 chars): "${content.substring(0, 120)}"`)

    if (!content || content.startsWith('NOOP')) {
      logger.info('AgentLoop: NOOP — no action taken.')
      return
    }

    // ── Parse and execute tool call(s) ────────────────────────────────────
    const commandMatch = content.match(/<<<RUN_COMMAND:\s*([\s\S]*?)>>>/)
    if (!commandMatch) {
      logger.info('AgentLoop: Response contained no valid RUN_COMMAND block — treating as NOOP.')
      return
    }

    try {
      const rawJson = commandMatch[1].trim()
      const firstBrace = rawJson.indexOf('{')
      if (firstBrace === -1) throw new Error('No JSON body found in RUN_COMMAND')
      const cmdData = JSON.parse(jsonrepair(rawJson.substring(firstBrace)))

      const actionDescription = await this._executeCommand(cmdData)
      if (actionDescription) {
        const entry = `[${now}] depth:${loopDepth} → ${actionDescription}`
        this._recentActions.push(entry)
        if (this._recentActions.length > MAX_RECENT_ACTIONS) this._recentActions.shift()

        // Recurse to check if more action is needed after this one
        await this._evaluate(loopDepth + 1)
      }
    } catch (err) {
      logger.error(`AgentLoop: Failed to parse/execute command: ${err.message}`)
    }
  }

  /**
       * Execute a single background-safe command.
       * Returns a short description string for the action log, or null if unsupported/failed.
       */
  async _executeCommand (cmdData, guildId = null) {
    const { getParam } = require('./commandHelper')
    const cmd = (cmdData.command || '').trim()

    if (cmd === 'remember') {
      const key = getParam(cmdData, 'key')
      const value = getParam(cmdData, 'value')
      const ttl = parseFloat(getParam(cmdData, 'ttl_days') ?? 30)
      if (!key || value === undefined) return null
      agentMemory.set(key, String(value), ttl, guildId)
      logger.info(`AgentLoop: [remember] ${key} = ${String(value).substring(0, 60)}`)
      return `remember: "${key}" = "${String(value).substring(0, 40)}"`
    }

    if (cmd === 'forget') {
      const key = getParam(cmdData, 'key')
      if (!key) return null
      agentMemory.delete(key)
      logger.info(`AgentLoop: [forget] ${key}`)
      return `forget: "${key}"`
    }

    if (cmd === 'recall') {
      const key = getParam(cmdData, 'key')
      if (!key) return null
      const val = agentMemory.get(key, null)
      logger.info(`AgentLoop: [recall] ${key} = ${val}`)
      // recall is read-only — don't re-evaluate, just log
      return `recall: "${key}" → "${val}"`
    }

    if (cmd === 'recall_keys') {
      // Find all keys matching a prefix — useful for finding existing entries to update
      const prefix = getParam(cmdData, 'prefix')
      if (!prefix) return null
      const all = agentMemory.getAll(null)
      const matching = Object.keys(all).filter(k => k.startsWith(prefix)).sort()
      logger.info(`AgentLoop: [recall_keys] ${prefix}* → ${matching.join(', ')}`)
      return `recall_keys: ${prefix}* → [${matching.join(', ')}]`
    }

    if (cmd === 'schedule') {
      const actionExecutor = require('./ActionExecutor')
      const res = await actionExecutor.executeAction('schedule_task', {
        description: getParam(cmdData, 'message'),
        when: getParam(cmdData, 'when'),
        repeat: getParam(cmdData, 'repeat'),
        channelId: getParam(cmdData, 'channelId'),
        userId: getParam(cmdData, 'userId')
      }, {
        client: this._bot,
        userId: 'agent_loop'
        // For background tasks, we don't need a real interaction, the action sends to channel directly
      })
      if (res.success) return `schedule: "${getParam(cmdData, 'message').substring(0, 40)}"`
      return null
    }

    if (cmd === 'cancel_task') {
      const id = getParam(cmdData, 'id')
      if (!id) return null
      const cancelled = agentScheduler.cancel(id)
      logger.info(`AgentLoop: [cancel_task] ${id} — ${cancelled ? 'succeeded' : 'not found'}`)
      return cancelled ? `cancel_task: ${id}` : null
    }

    if (cmd === 'modify_action') {
      const actionExecutor = require('./ActionExecutor')
      const name = getParam(cmdData, 'name')
      if (!name) {
        logger.warn('AgentLoop: [modify_action] Missing required field: name')
        return null
      }
      const updates = {}
      const desc = getParam(cmdData, 'description')
      const schema = getParam(cmdData, 'schema')
      const code = getParam(cmdData, 'code')

      if (desc) updates.description = desc
      if (schema) updates.schema = schema
      if (code) updates.code = code

      if (Object.keys(updates).length === 0) {
        logger.warn('AgentLoop: [modify_action] No updates provided — nothing to change.')
        return null
      }
      const result = actionExecutor.modifyAction(name, updates)
      if (result.success) {
        logger.info(`AgentLoop: [modify_action] Updated action "${name}"`)
        return `modify_action: "${name}" updated (fields: ${Object.keys(updates).join(', ')})`
      } else {
        logger.warn(`AgentLoop: [modify_action] Failed: ${result.error}`)
        return null
      }
    }

    if (cmd === 'create_action') {
      const actionExecutor = require('./ActionExecutor')
      const name = getParam(cmdData, 'name')
      const description = getParam(cmdData, 'description')
      const schema = getParam(cmdData, 'schema') || {}
      const code = getParam(cmdData, 'code')
      if (!name || !description || !code) {
        logger.warn('AgentLoop: [create_action] Missing required fields: name, description, code')
        return null
      }
      const result = actionExecutor.registerAction(name, description, schema, code)
      if (result.success) {
        logger.info(`AgentLoop: [create_action] Registered new action "${name}"`)
        return `create_action: "${name}" registered successfully`
      } else {
        logger.warn(`AgentLoop: [create_action] Failed to register "${name}": ${result.error}`)
        return null
      }
    }

    if (cmd === 'delete_action') {
      const actionExecutor = require('./ActionExecutor')
      const name = getParam(cmdData, 'name')
      if (!name) return null
      const result = actionExecutor.deleteAction(name)
      if (result.success) {
        logger.info(`AgentLoop: [delete_action] Removed action "${name}"`)
        return `delete_action: "${name}" removed`
      } else {
        logger.warn(`AgentLoop: [delete_action] Failed: ${result.error}`)
        return null
      }
    }

    if (cmd === 'trigger_self_healing') {
      const selfHealing = require('./chat/SelfHealingEngine')
      const targetType = getParam(cmdData, 'target_type') || 'action'
      const name = getParam(cmdData, 'name')
      const error = getParam(cmdData, 'error') || 'Runtime failure detected during background evaluation.'
      if (!name) return null

      const actionExecutor = require('./ActionExecutor')
      if (targetType === 'action') {
        const actionObj = actionExecutor._actions?.[name]
        if (actionObj) {
          await selfHealing.proposeActionFix({
            actionName: name,
            description: actionObj.description,
            schema: actionObj.schema,
            code: actionObj.execute?.toString() || '',
            error,
            params: {},
            client: this._bot
          })
          return `trigger_self_healing: Dispatched repair proposal for action "${name}"`
        }
      } else if (targetType === 'slash') {
        await selfHealing.proposeSlashCommandFix({
          commandName: name,
          error,
          client: this._bot
        })
        return `trigger_self_healing: Dispatched repair proposal for slash command "/${name}"`
      }
      return null
    }

    // Dynamic execution of any registered ActionExecutor action (manage_triggers, manage_workflows, etc.)
    const actionExecutor = require('./ActionExecutor')
    const allActions = actionExecutor.listActions()
    const matchingAction = allActions.find(a => a.name === cmd)
    if (matchingAction) {
      const params = cmdData.params || { ...cmdData }
      delete params.command
      const res = await actionExecutor.executeAction(cmd, params, {
        client: this._bot,
        userId: 'agent_loop',
        guildId
      })
      if (res.success) {
        logger.info(`AgentLoop: [${cmd}] executed successfully`)
        return `${cmd}: ${typeof res.output === 'string' ? res.output.substring(0, 60) : 'success'}`
      } else {
        logger.warn(`AgentLoop: [${cmd}] Failed: ${res.error}`)
        return null
      }
    }

    logger.warn(`AgentLoop: Command "${cmd}" is not supported in background context — ignoring.`)
    return null
  }

  /** Expose diagnostics for testing / admin inspection. */
  get status () {
    return {
      running: !!this._interval,
      isEvaluating: this._isRunning,
      tickCount: this._tickCount,
      lastRunAt: this._lastRunAt,
      recentActions: [...this._recentActions]
    }
  }
}

module.exports = new AgentLoop()
