const logger = require('../logger')
const agentMemory = require('./AgentMemory')
const agentScheduler = require('./AgentScheduler')
const { jsonrepair } = require('jsonrepair')

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

      // 2. Proactive "Interjection" check for whitelisted guilds
      await this._checkProactiveGuilds()
    } catch (err) {
      logger.error(`AgentLoop: Uncaught exception in tick: ${err.stack || err.message}`)
    } finally {
      this._isRunning = false
      this._lastRunAt = Date.now()
      logger.info(`AgentLoop: Tick #${this._tickCount} complete.`)
    }
  }

  /**
     * Iterate through all whitelisted guilds and decide if we should chime in.
     */
  async _checkProactiveGuilds () {
    if (!this._bot) return

    // Fetch settings from Firebase
    const database = require('../firebase-login')()
    if (!database) return

    const snapshot = await database.ref('guild_settings').once('value')
    if (!snapshot.exists()) return
    const guildSettings = snapshot.val()

    for (const guildId in guildSettings) {
      if (!guildSettings[guildId].agent_enabled) continue

      const guild = this._bot.guilds.cache.get(guildId)
      if (!guild) continue

      const channels = await guild.channels.fetch()
      const textChannels = channels.filter(c =>
        c.isTextBased() && !c.isThread() && c.viewable &&
        c.permissionsFor(this._bot.user).has(['SendMessages', 'ReadMessageHistory']) &&
        c.lastMessageId
      )

      // Pick the 3 channels with the most recent activity.
      // Discord snowflake IDs are time-ordered, so a simple string comparison gives us recency.
      const topChannels = [...textChannels.values()]
        .sort((a, b) => (a.lastMessageId > b.lastMessageId ? -1 : 1))
        .slice(0, 3)

      for (const channel of topChannels) {
        await this._evaluateProactivePresence(channel, guildId)
      }
    }
  }

  async _evaluateProactivePresence (channel, guildId) {
    logger.info(`AgentLoop: Evaluating proactive presence for #${channel.name} in ${guildId}...`)

    try {
      // Peek at the last 20 messages
      const messages = await channel.messages.fetch({ limit: 20 })
      if (messages.size < 3) return // Too quiet

      // RECENCY CHECK: Only evaluate if the conversation is still "alive" (last message within 15 mins)
      const lastMessage = messages.first()
      const fifteenMinsAgo = Date.now() - 15 * 60 * 1000
      if (lastMessage.createdAt.getTime() < fifteenMinsAgo) {
        logger.info(`AgentLoop: skipping #${channel.name} — conversation is stale.`)
        return
      }

      // MESSAGE ID TRACKING: Skip if we've already evaluated this exact conversation snapshot.
      // This prevents redundant Ollama calls and re-evaluating messages we've already seen.
      // A new message (including one that references an older one) will always produce a new ID.
      const lastMsgKey = `proactive.last_msg.${channel.id}`
      const lastSeenMsgId = agentMemory.get(lastMsgKey, guildId)
      if (lastSeenMsgId && lastSeenMsgId === lastMessage.id) {
        logger.info(`AgentLoop: skipping #${channel.name} — no new messages since last evaluation.`)
        return
      }

      const botId = this._bot?.user?.id
      const { formatMessagesForContext } = require('./chat/contextHelper')
      const history = formatMessagesForContext(messages, botId)

      const conversationContext = history.map(m => m.content).join('\n')
      const now = new Date().toLocaleString()

      const prompt = `You are Skynet, a helpful and occasionally humorous autonomous agent.
You are observing a conversation in #${channel.name}.
Current time: ${now}

[CONVERSATION CONTENT]
${conversationContext}

Your goal is to decide if you should PROACTIVELY interact.
You have three ways to interact:
1. INTERJECT: Provide a helpful suggestion, search result suggestion, or a witty comment if the situation TRULY calls for it.
2. REACT: React with an emoji to a specific message if you "really like" it, find it funny, or find it highly relevant.
3. REMEMBER: If you see a piece of information, a preference, or an important fact in the conversation that should be kept for later, use the 'remember' command.

Rules:
- Be VERY selective. Most of the time, respond with: NOOP
- ONLY interject if you can be highly useful or adding genuine value.
- ONLY react if a message is particularly good. Don't react to every message.
- ONLY remember if the information is genuinely useful for future context.
- If interjecting, use: <<<INTERJECT: "Your message here">>>
- If reacting, use: <<<REACT: {"messageId": "...", "emoji": "...", "reason": "..."}>>>
- To remember (server context, expires 7 days): <<<RUN_COMMAND: {"command": "remember", "key": "server.topic", "value": "...", "ttl_days": 7}>>>
- To remember a permanent user fact: <<<RUN_COMMAND: {"command": "remember", "key": "user.name.fact", "value": "...", "ttl_days": -1}>>>
- You can also trigger other tool calls: <<<RUN_COMMAND: {"command": "...", ...}>>>
- You can do multiple in one response if appropriate (e.g. remember AND react).

Standard Emojis: 👍, 😂, 🔥, ✨, ❤️, 💯, 🤔.

If nothing is needed, respond with: NOOP`

      const { queryLocalOrRemote } = require('./ollama')
      const result = await queryLocalOrRemote('/api/chat', {
        messages: [{ role: 'system', content: prompt }],
        options: { temperature: 0.3 }
      })

      const content = result?.message?.content?.trim() || ''

      // Always record the newest message ID we've evaluated, regardless of outcome.
      // This is the primary gate — reactions and interjections both benefit from it.
      agentMemory.set(lastMsgKey, lastMessage.id, 15 / (60 * 24), guildId) // expires in 15 minutes — matches the recency window

      // Handle Interjections
      if (content.includes('<<<INTERJECT:')) {
        const msgMatch = content.match(/<<<INTERJECT:\s*"([\s\S]*?)"/)
        const intercom = msgMatch ? msgMatch[1] : null
        if (intercom) {
          await channel.send(`*(Proactive Suggestion)* ${intercom}`)
          logger.info(`AgentLoop: Interjected in #${channel.name}: "${intercom.substring(0, 50)}..."`)
        }
      }

      // Handle Reactions (Multiple allowed, no separate cooldown — message ID tracking prevents repeats)
      const reactMatches = content.matchAll(/<<<REACT:\s*([\s\S]*?)>>>/g)
      for (const match of reactMatches) {
        try {
          const data = JSON.parse(jsonrepair(match[1]))
          if (data.messageId && data.emoji) {
            const message = await channel.messages.fetch(data.messageId).catch(() => null)
            if (message) {
              const existing = message.reactions.cache.get(data.emoji) ||
                message.reactions.cache.find(r => r.emoji.name === data.emoji || r.emoji.id === data.emoji)
              if (!existing || !existing.me) {
                await message.react(data.emoji).catch(() => {})
                logger.info(`AgentLoop: Proactively reacted with ${data.emoji} to message ${data.messageId}.`)
              }
            }
          }
        } catch (e) {
          logger.warn(`AgentLoop: Failed to parse reaction tag: ${e.message}`)
        }
      }

      // Handle Tool Calls
      const cmdMatch = content.match(/<<<RUN_COMMAND:\s*([\s\S]*?)>>>/)
      if (cmdMatch) {
        const cmdData = JSON.parse(jsonrepair(cmdMatch[1]))
        await this._executeCommand(cmdData, guildId)
      }
    } catch (err) {
      logger.error(`AgentLoop proactive presence evaluation error: ${err.message}`)
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

    const actionExecutor = require('./ActionExecutor')
    const actionList = actionExecutor.listActions()
      .map(a => `  - ${a.name}: ${a.description}`)
      .join('\n') || '  None'

    const systemPrompt = `You are Skynet's autonomous background daemon agent.
Current time: ${now}

Your objective is to evaluate the current state and decide if any PROACTIVE action is needed.

[LONG-TERM MEMORY]
${memorySummary}

[SCHEDULED TASKS]
${taskList}

[RECENT AGENT ACTIONS]
${recentActions}

[AVAILABLE DISCORD ACTIONS]
These are the actions the scheduler can execute when tasks fire. You can create new ones.
${actionList}

Rules:
- If nothing requires action right now, respond with exactly: NOOP
- Only act if you have a clear, specific reason derived from the above data.
- Available commands: remember, forget, recall, schedule, cancel_task, create_action, delete_action
- Format: <<<RUN_COMMAND: {"command": "...", ...}>>>
- DO NOT attempt to search the web, play music, generate images, or send arbitrary messages.
- DO NOT schedule tasks speculatively — only if there is explicit context to do so.

create_action schema:
<<<RUN_COMMAND: {"command": "create_action", "name": "snake_case_name", "description": "What it does", "schema": {"param": "type — description"}, "code": "// discord.js code here\\nawait channel.send(params.content);"}>>>
- Only discord.js APIs allowed. No require('fs'), require('child_process'), process.env, or eval.
- Built-in actions (send_message, send_poll, send_embed, send_thread) cannot be overwritten.

delete_action schema:
<<<RUN_COMMAND: {"command": "delete_action", "name": "action_name"}>>>
- Only custom (AI-generated) actions can be deleted.

modify_action schema (all fields optional except name):
<<<RUN_COMMAND: {"command": "modify_action", "name": "existing_name", "description": "updated description", "code": "// new code"}>>>
- Only custom actions can be modified. Omit any field you don't want to change.

After your tool call, briefly explain WHY (one sentence). Example:
<<<RUN_COMMAND: {"command": "remember", "key": "server.last_health_check", "value": "2026-04-18", "ttl_days": 7}>>>
Reason: Recording health check timestamp for diagnostics.`

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Evaluate the current state. NOOP if nothing is needed.' }
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
