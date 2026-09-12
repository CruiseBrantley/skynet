const fs = require('fs')
const path = require('path')
const logger = require('../logger')
const { jsonrepair } = require('jsonrepair')

const BUILTIN_DIR = path.join(__dirname, 'actions')
const CUSTOM_DIR = path.join(__dirname, '../data/agent_actions')

/**
 * Patterns that are NEVER allowed in AI-generated action code.
 * Any match causes the registration to be rejected.
 */
const FORBIDDEN_PATTERNS = [
  /require\s*\(\s*['"`]fs['"`]\s*\)/,
  /require\s*\(\s*['"`]child_process['"`]\s*\)/,
  /require\s*\(\s*['"`]os['"`]\s*\)/,
  /require\s*\(\s*['"`]net['"`]\s*\)/,
  /require\s*\(\s*['"`]http['"`]\s*\)/,
  /require\s*\(\s*['"`]https['"`]\s*\)/,
  /process\s*\.\s*(env|exit|kill|binding)/,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\b__dirname\b/,
  /\b__filename\b/,
  /\.exec\s*\(/,
  /\.spawn\s*\(/,
  /\.execSync\s*\(/
]

/**
 * ActionExecutor — loads built-in and AI-generated Discord actions,
 * classifies task intent via local Ollama, and executes the appropriate action.
 */
class ActionExecutor {
  constructor () {
    this._actions = {}
    this._loadBuiltins()
    this._loadCustom()
  }

  // ─── Loading ────────────────────────────────────────────────────────────────

  _loadBuiltins () {
    if (!fs.existsSync(BUILTIN_DIR)) return
    for (const file of fs.readdirSync(BUILTIN_DIR).filter(f => f.endsWith('.js'))) {
      try {
        const fullPath = path.join(BUILTIN_DIR, file)
        const action = require(fullPath)
        this._actions[action.name] = action
        logger.info(`ActionExecutor: Loaded built-in action "${action.name}"`)
      } catch (e) {
        logger.error(`ActionExecutor: Failed to load built-in "${file}": ${e.message}`)
      }
    }
  }

  _loadCustom () {
    if (!fs.existsSync(CUSTOM_DIR)) return
    for (const file of fs.readdirSync(CUSTOM_DIR).filter(f => f.endsWith('.js'))) {
      try {
        const fullPath = path.join(CUSTOM_DIR, file)
        // Clear cache so hot-reload works without restart
        delete require.cache[require.resolve(fullPath)]
        const action = require(fullPath)
        this._actions[action.name] = action
        logger.info(`ActionExecutor: Loaded custom action "${action.name}"`)
      } catch (e) {
        logger.error(`ActionExecutor: Failed to load custom "${file}": ${e.message}`)
      }
    }
  }

  hasAction (name) {
    if (!name) return false
    return Boolean(this._actions[name.toLowerCase()])
  }

  listActions (options = {}) {
    const isOwner = Boolean(
      options && (
        options.isOwner ||
        options.userId === process.env.OWNER_ID ||
        options.profileId === 'sirian' ||
        options.user?.id === process.env.OWNER_ID ||
        options.user?.username?.toLowerCase() === 'sirian'
      )
    )
    const isPrivate = options && options.isPrivate !== undefined ? Boolean(options.isPrivate) : true
    return Object.values(this._actions)
      .filter(a => {
        if (a.ownerOnly && !isOwner) return false
        const requiresPrivate = Boolean(a.privateOnly || ['host_exec', 'host_read_file', 'host_write_file'].includes(a.name))
        if (requiresPrivate && !isPrivate) return false
        return true
      })
      .map(a => ({
        name: a.name,
        description: a.description,
        schema: a.schema,
        ownerOnly: Boolean(a.ownerOnly)
      }))
  }

  /**
   * Parses schema definitions in both object format and string shorthand
   * (e.g. "string — description", "string[] — array of items").
   * @param {object|string} def
   * @returns {{ type: string, description: string, enum?: Array<string>, items?: object, required?: boolean }}
   */
  static parseSchemaDefinition (def) {
    if (!def) return { type: 'string', description: '' }
    if (typeof def === 'object' && def !== null) {
      const type = def.type || 'string'
      const description = def.description || ''
      const res = { type, description }
      if (def.enum && Array.isArray(def.enum)) res.enum = def.enum
      if (def.required) res.required = true
      if (type === 'array') {
        res.items = def.items || { type: 'string' }
      }
      return res
    }
    if (typeof def === 'string') {
      const match = def.match(/^([a-zA-Z0-9_[\]]+)\s*(?:[—–\-:]\s*(.*))?$/)
      if (match) {
        const rawType = match[1].toLowerCase()
        const description = (match[2] || '').trim()
        let type = 'string'
        let items = null
        if (rawType.endsWith('[]') || rawType === 'array' || rawType === 'list') {
          type = 'array'
          items = { type: rawType.startsWith('number') ? 'number' : (rawType.startsWith('object') ? 'object' : 'string') }
        } else if (rawType === 'number' || rawType === 'int' || rawType === 'integer' || rawType === 'float') {
          type = 'number'
        } else if (rawType === 'boolean' || rawType === 'bool') {
          type = 'boolean'
        } else if (rawType === 'object') {
          type = 'object'
        }
        const res = { type, description: description || def }
        if (items) res.items = items
        return res
      }
      return { type: 'string', description: def }
    }
    return { type: 'string', description: String(def) }
  }

  parseSchemaDefinition (def) {
    return ActionExecutor.parseSchemaDefinition(def)
  }

  /**
   * Converts registered actions into standard JSON schema tool definitions
   * compatible with Ollama and OpenAI function calling API.
   * @param {object} options
   * @returns {Array<object>}
   */
  getOllamaToolsSchema (options = {}) {
    const actions = this.listActions(options)
    return actions.map(a => {
      const properties = {}
      const required = []

      if (a.schema && typeof a.schema === 'object') {
        for (const [key, rawDef] of Object.entries(a.schema)) {
          const def = ActionExecutor.parseSchemaDefinition(rawDef)
          properties[key] = {
            type: def.type,
            description: def.description
          }
          if (def.enum && Array.isArray(def.enum)) {
            properties[key].enum = def.enum
          }
          if (def.items) {
            properties[key].items = def.items
          }
          if (def.required) {
            required.push(key)
          }
        }
      }

      return {
        type: 'function',
        function: {
          name: a.name,
          description: a.description || `Execute action ${a.name}`,
          parameters: {
            type: 'object',
            properties,
            ...(required.length > 0 ? { required } : {})
          }
        }
      }
    })
  }

  // ─── Classification ──────────────────────────────────────────────────────────

  /**
     * Use local Ollama to classify a task description into an action + params.
     * Also extracts any Discord channel mention as a channel ID override.
     * @param {object} task
     * @returns {Promise<{ action: string, params: object, override_channel_id?: string }>}
     */
  async classify (task) {
    if (task.action && this._actions[task.action]) {
      return {
        action: task.action,
        params: task.params || {},
        override_channel_id: task.override_channel_id || null
      }
    }

    // Scheduled task execution must deliver content, never loop into scheduling tools
    const nonExecutableInTask = new Set(['schedule_task', 'cancel_task', 'list_tasks', 'update_task'])
    const actionList = this.listActions()
      .filter(a => !nonExecutableInTask.has(a.name))
      .map(a => `- ${a.name}: ${a.description}\n  Schema: ${JSON.stringify(a.schema)}`)
      .join('\n')

    const prompt = `You are a Discord bot action classifier. Given a scheduled task description, select the most appropriate action and extract its parameters.

Available Actions:
${actionList}

Task Description: "${task.description}"

Rules:
1. Choose the MOST APPROPRIATE action from the list.
2. Extract ALL required parameters from the description.
3. If the description contains a Discord channel mention like <#1234567890>, extract the numeric channel ID as "override_channel_id".
4. Respond with ONLY a JSON object. No explanation, no markdown.

Example output:
{"action":"send_poll","override_channel_id":"580867049006301214","params":{"question":"Who is attending?","options":["Yes","No","Maybe"],"duration_hours":24}}`

    const classificationLevel = 0
    let result

    try {
      const { queryOllama } = require('./ollama')
      result = await queryOllama('/api/chat', {
        messages: [
          { role: 'system', content: 'You are a technical action classifier. You respond with ONLY a valid JSON object and NO other text. No thinking, no explanations, no markdown code blocks.' },
          { role: 'user', content: prompt }
        ],
        options: { temperature: 0, num_predict: 256 }
      }, classificationLevel)

      let raw = result?.message?.content?.trim() || ''
      let firstBrace = raw.indexOf('{')
      let lastBrace = raw.lastIndexOf('}')

      // If Level 0 failed to provide JSON, try Level 2 (Gemini) as a direct retry
      if ((firstBrace === -1 || lastBrace === -1) && classificationLevel === 0) {
        logger.info('ActionExecutor: Level 0 classification produced no JSON. Retrying directly with Level 2 (Gemini)...')
        result = await queryOllama('/api/chat', {
          messages: [
            { role: 'system', content: 'You are a technical action classifier. Output ONLY valid JSON.' },
            { role: 'user', content: prompt }
          ]
        }, 2)
        raw = result?.message?.content?.trim() || ''
        firstBrace = raw.indexOf('{')
        lastBrace = raw.lastIndexOf('}')
      }

      if (firstBrace === -1 || lastBrace === -1) throw new Error('No JSON object in response after retry')
      const parsed = JSON.parse(jsonrepair(raw.substring(firstBrace, lastBrace + 1)))

      // Prevent classified action from looping back into scheduling tools
      if (parsed.action && nonExecutableInTask.has(parsed.action)) {
        logger.warn(`ActionExecutor: Classifier returned disallowed task action "${parsed.action}". Fallback to send_message.`)
        parsed.action = 'send_message'
        parsed.params = { content: task.description }
      }

      return parsed
    } catch (e) {
      logger.warn(`ActionExecutor: Classification failed (${e.message}). Falling back to send_message.`)
      // Extract channel mentions even on fallback
      const channelMatch = task.description.match(/<#(\d+)>/)
      return {
        action: 'send_message',
        override_channel_id: channelMatch?.[1] || null,
        params: { content: task.description.replace(/<#\d+>/g, '').trim() }
      }
    }
  }

  // ─── Channel Resolution ──────────────────────────────────────────────────────

  /**
     * Resolve the Discord channel/DM to deliver to.
     * @param {import('discord.js').Client} bot
     * @param {object} task
     * @param {string|null} overrideChannelId - Takes priority over task.channelId if present
     */
  async resolveChannel (bot, task, overrideChannelId) {
    if (!bot) return null
    const channelId = overrideChannelId || task.channelId

    // Priority 1: explicit DM channel
    if ((channelId === 'dm' || !channelId) && task.userId) {
      if (bot.users?.fetch) {
        const user = await bot.users.fetch(task.userId).catch(() => null)
        if (user) {
          return await user.createDM().catch(() => null)
        }
      }
    }

    // Priority 2: specified channel ID (takes precedence over DM fallback)
    if (channelId && channelId !== 'dm' && !channelId.startsWith('cli_') && !channelId.startsWith('web_') && channelId !== 'terminal') {
      if (bot.channels?.cache?.get) {
        return bot.channels.cache.get(channelId) ||
                   await bot.channels.fetch?.(channelId).catch(() => null)
      }
    }

    // Priority 3: DM as last resort
    if (task.userId && bot.users?.fetch) {
      const user = await bot.users.fetch(task.userId).catch(() => null)
      if (user) {
        return await user.createDM().catch(() => null)
      }
    }

    return null
  }

  // ─── Execution ───────────────────────────────────────────────────────────────

  /**
     * Classify and execute a scheduled task using the appropriate action.
     * @param {import('discord.js').Client} bot
     * @param {object} task
     * @returns {Promise<boolean>} Whether delivery succeeded
     */
  async execute (bot, task) {
    // Hot-reload custom actions before every execution
    this._loadCustom()

    const conversationStore = require('../core/conversationStore')
    const classified = await this.classify(task)
    logger.info(`ActionExecutor: Task "${task.id}" → action="${classified.action}" channel_override="${classified.override_channel_id || 'none'}"`)

    let action = this._actions[classified.action]
    if (!action) {
      logger.warn(`ActionExecutor: Unknown action "${classified.action}" — falling back to send_message`)
      action = this._actions.send_message
      if (!action) {
        logger.error('ActionExecutor: send_message fallback missing. Cannot deliver.')
        return false
      }
      classified.params = { content: task.description }
    }

    const isIndividual = !task.guildId || task.channelId === 'dm' || task.channelId === 'terminal' || (task.channelId && (task.channelId.startsWith('cli_') || task.channelId.startsWith('web_')))
    let deliveredAnywhere = false

    // Record notification in conversationStore for individual/personal tasks so Web & CLI clients see it
    if (isIndividual) {
      const isOwner = task.userId === process.env.OWNER_ID
      const profileId = conversationStore.resolveProfileId(task.userId, isOwner)
      const alertContent = classified.params?.content || classified.params?.message || `⏰ Scheduled Alert: ${task.description}`
      try {
        conversationStore.appendMessage(profileId, {
          role: 'assistant',
          content: alertContent,
          author: 'Skynet',
          source: 'scheduler',
          timestamp: Date.now()
        })
        logger.info(`ActionExecutor: Appended task alert ${task.id} to conversation store for profile "${profileId}"`)
        deliveredAnywhere = true
      } catch (storeErr) {
        logger.warn(`ActionExecutor: Failed to record task alert in conversationStore: ${storeErr.message}`)
      }
    }

    const channel = await this.resolveChannel(bot, task, classified.override_channel_id)
    if (channel) {
      try {
        await action.execute(bot, channel, classified.params || {}, {
          isScheduled: true,
          isInteractive: false,
          taskId: task.id,
          task
        })
        logger.info(`ActionExecutor: Successfully executed "${classified.action}" for task ${task.id} in channel ${channel.id || 'DM'}`)
        return true
      } catch (err) {
        logger.error(`ActionExecutor: Action "${classified.action}" threw an error for task ${task.id}: ${err.message}`)
        return deliveredAnywhere
      }
    } else {
      if (bot && bot.users && task.userId) {
        logger.warn(`ActionExecutor: Could not resolve target channel for task ${task.id}. Attempting DM fallthrough...`)
        const user = await bot.users.fetch(task.userId).catch(() => null)
        if (user) {
          const dmChannel = await user.createDM().catch(() => null)
          if (dmChannel) {
            const fallbackMsg = `⚠️ **Task Fallthrough:** I couldn't find the original target channel for your scheduled task. Here is the content:\n\n**Task:** ${task.description}`
            await dmChannel.send(fallbackMsg).catch(() => {})
            logger.info(`ActionExecutor: Delivered fallthrough notification to user ${task.userId} for task ${task.id}`)
            return true
          }
        }
      }
    }

    if (deliveredAnywhere) {
      logger.info(`ActionExecutor: Delivered task ${task.id} via persistent store for profile backlog.`)
      return true
    }

    logger.error(`ActionExecutor: Total failure to deliver task ${task.id} — no channel, no DM, and no profile store possible.`)
    return false
  }

  // ─── Action Registration (AI-generated) ─────────────────────────────────────

  /**
     * Register a new AI-generated action. Validates code safety before saving to disk.
     * @param {string} name - Lowercase alphanumeric identifier
     * @param {string} description - Human-readable description for the classifier
     * @param {object} schema - Parameter descriptions
     * @param {string} code - The function body (will be wrapped in async (bot, channel, params) => { })
     * @returns {{ success: boolean, error?: string }}
     */
  registerAction (name, description, schema, code) {
    // Structural safety check for known problematic patterns (like the poll_media abstraction mismatch)
    if (code.includes('poll_media:')) {
      return { success: false, error: 'Structural Error: Native polls must use the flat { text: "..." } structure for answers, NOT the nested poll_media wrapper. Fix the code and retry.' }
    }

    // Validate name format
    if (!/^[a-z][a-z0-9_]{1,49}$/.test(name)) {
      return { success: false, error: 'Name must be 2–50 lowercase alphanumeric chars/underscores, starting with a letter.' }
    }

    // Never overwrite built-ins
    if (fs.existsSync(path.join(BUILTIN_DIR, `${name}.js`))) {
      return { success: false, error: `"${name}" is a protected built-in action and cannot be overwritten.` }
    }

    // Security scan
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(code)) {
        const hit = code.match(pattern)?.[0]
        logger.warn(`ActionExecutor: Rejected action "${name}" — forbidden pattern: "${hit}"`)
        return { success: false, error: `Forbidden operation detected: "${hit}". Only Discord.js APIs are allowed.` }
      }
    }

    // Validate syntax — wrap in async since execute is always async
    try {
      new Function('bot', 'channel', 'params', `return (async (bot, channel, params) => { ${code} })(bot, channel, params);`) // eslint-disable-line no-new-func, no-new
    } catch (e) {
      return { success: false, error: `Syntax error in action code: ${e.message}` }
    }

    // Write to disk
    if (!fs.existsSync(CUSTOM_DIR)) fs.mkdirSync(CUSTOM_DIR, { recursive: true })

    const fileContent = `// Auto-generated action: ${name}
// Created: ${new Date().toISOString()}
// Description: ${description}
// WARNING: This file was generated by the Skynet AgentLoop. Edit with caution.

module.exports = {
    name: ${JSON.stringify(name)},
    description: ${JSON.stringify(description)},
    schema: ${JSON.stringify(schema, null, 4)},
    execute: async (bot, channel, params) => {
${code.split('\n').map(l => '        ' + l).join('\n')}
    }
};
`

    const filePath = path.join(CUSTOM_DIR, `${name}.js`)
    fs.writeFileSync(filePath, fileContent)

    // Immediately load without restart
    try {
      delete require.cache[require.resolve(filePath)]
      const action = require(filePath)
      this._actions[action.name] = action
      logger.info(`ActionExecutor: Registered and loaded new custom action "${name}"`)
      return { success: true }
    } catch (e) {
      fs.unlinkSync(filePath) // Roll back the file on load failure
      return { success: false, error: `Action registered but failed to load: ${e.message}` }
    }
  }

  /**
     * Modify an existing AI-generated action. Supports partial updates:
     * only the fields provided (description, schema, code) are updated.
     * Built-in actions cannot be modified.
     * @param {string} name
     * @param {{ description?: string, schema?: object, code?: string }} updates
     * @returns {{ success: boolean, error?: string }}
     */
  modifyAction (name, updates) {
    if (fs.existsSync(path.join(BUILTIN_DIR, `${name}.js`))) {
      return { success: false, error: `"${name}" is a built-in action and cannot be modified.` }
    }

    const filePath = path.join(CUSTOM_DIR, `${name}.js`)
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `No custom action named "${name}" found. Use create_action to create it first.` }
    }

    // Load the current version
    let current
    try {
      delete require.cache[require.resolve(filePath)]
      current = require(filePath)
    } catch (e) {
      return { success: false, error: `Could not load existing action "${name}": ${e.message}` }
    }

    // Merge: only override what was provided
    const newDescription = updates.description ?? current.description
    const newSchema = updates.schema ?? current.schema
    const newCode = updates.code

    // Extract existing code from the file if no new code provided
    let codeToValidate = newCode
    if (!codeToValidate) {
      // Re-use existing execute body — extract it from file text
      const raw = fs.readFileSync(filePath, 'utf8')
      const match = raw.match(/execute:\s*async\s*\(bot,\s*channel,\s*params\)\s*=>\s*\{([\s\S]*?)\n {4}\}\n\};/)
      codeToValidate = match ? match[1].trim() : ''
    }

    // Security and Structural scan on new code (if provided)
    if (updates.code) {
      if (updates.code.includes('poll_media:')) {
        return { success: false, error: 'Structural Error: Native polls must use the flat { text: "..." } structure for answers, NOT the nested poll_media wrapper. Fix the code and retry.' }
      }
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(updates.code)) {
          const hit = updates.code.match(pattern)?.[0]
          logger.warn(`ActionExecutor: Rejected modify "${name}" — forbidden pattern: "${hit}"`)
          return { success: false, error: `Forbidden operation detected: "${hit}". Only Discord.js APIs are allowed.` }
        }
      }
      // Validate syntax — wrap in async since execute is always async
      try {
        new Function('bot', 'channel', 'params', `return (async (bot, channel, params) => { ${updates.code} })(bot, channel, params);`) // eslint-disable-line no-new-func, no-new
      } catch (e) {
        return { success: false, error: `Syntax error in updated code: ${e.message}` }
      }
    }

    const fileContent = `// Auto-generated action: ${name}
// Last modified: ${new Date().toISOString()}
// Description: ${newDescription}
// WARNING: This file was generated by the Skynet AgentLoop. Edit with caution.

module.exports = {
    name: ${JSON.stringify(name)},
    description: ${JSON.stringify(newDescription)},
    schema: ${JSON.stringify(newSchema, null, 4)},
    execute: async (bot, channel, params) => {
${codeToValidate.split('\n').map(l => '        ' + l).join('\n')}
    }
};
`

    fs.writeFileSync(filePath, fileContent)

    try {
      delete require.cache[require.resolve(filePath)]
      const action = require(filePath)
      this._actions[action.name] = action
      logger.info(`ActionExecutor: Modified and reloaded custom action "${name}"`)
      return { success: true }
    } catch (e) {
      return { success: false, error: `Action saved but failed to reload: ${e.message}` }
    }
  }

  /**
     * Delete a custom AI-generated action by name.
     * Built-ins cannot be deleted.
     * @param {string} name
     * @returns {{ success: boolean, error?: string }}
     */
  deleteAction (name) {
    if (fs.existsSync(path.join(BUILTIN_DIR, `${name}.js`))) {
      return { success: false, error: `"${name}" is a built-in action and cannot be deleted.` }
    }
    const filePath = path.join(CUSTOM_DIR, `${name}.js`)
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `No custom action named "${name}" found.` }
    }
    fs.unlinkSync(filePath)
    delete this._actions[name]
    logger.info(`ActionExecutor: Deleted custom action "${name}"`)
    return { success: true }
  }

  /**
     * Directly execute an action by name with params and a Discord context.
     * @param {string} name - Action name
     * @param {object} params - Action parameters
     * @param {object} context - Object with { client, channel } or a Discord Interaction
     * @returns {Promise<{ success: boolean, error?: string }>}
     */
  async executeAction (name, params, context = {}) {
    logger.info(`ActionExecutor: Triggering action "${name}" with params: ${JSON.stringify(params).substring(0, 500)}`)
    const action = this._actions[name]
    if (!action) return { success: false, error: `unknown action: ${name}` }

    const safeContext = context || {}

    // RBAC Security Check: Owner-only action guard
    if (action.ownerOnly) {
      const isOwner = Boolean(
        safeContext.isOwner ||
        safeContext.userId === process.env.OWNER_ID ||
        safeContext.user?.id === process.env.OWNER_ID ||
        safeContext.profileId === 'sirian' ||
        safeContext.user?.username?.toLowerCase() === 'sirian'
      )
      const isPrivate = Boolean(
        !safeContext.guildId ||
        safeContext.channel?.type === 1 || // Discord DM
        safeContext.isDM ||
        safeContext.clientId === 'web' ||
        safeContext.clientId === 'cli'
      )

      if (!isOwner) {
        logger.warn(`ActionExecutor: Access Denied for action "${name}" — user is not owner.`)
        return {
          success: false,
          error: `[SYSTEM: Access Denied: Action "${name}" is strictly restricted to the bot owner.]`
        }
      }

      const requiresPrivate = Boolean(action.privateOnly || ['host_exec', 'host_read_file', 'host_write_file'].includes(name))
      if (requiresPrivate && !isPrivate) {
        logger.warn(`ActionExecutor: Access Denied for action "${name}" — attempted in public server channel.`)
        return {
          success: false,
          error: `[SYSTEM: Access Denied: Action "${name}" can only be executed in private 1-on-1 sessions (Direct Message or Web Chat), not in public server channels.]`
        }
      }
    }

    // Compatibility layer: handle interaction, bot object, or specific client/channel keys
    const bot = safeContext.client || safeContext.bot || safeContext
    let channel = safeContext.channel || safeContext

    // Support channel override in params (ID, mention, or NAME)
    const channelInput = (params.channel || params.channelId || '').toString()
    const targetId = channelInput.replace(/[<#>]/g, '')

    if (targetId && bot && bot.channels) {
      // Priority 1: Direct ID lookup
      let resolved = bot.channels.cache.get(targetId) || await bot.channels.fetch(targetId).catch(() => null)

      // Priority 2: Name lookup (if in a guild)
      if (!resolved && context.guild && context.guild.channels) {
        resolved = context.guild.channels.cache.find(c =>
          c.name.toLowerCase() === targetId.toLowerCase() ||
                    c.name.toLowerCase() === channelInput.toLowerCase()
        )
      }

      if (resolved) channel = resolved
    }

    try {
      const output = await action.execute(bot, channel, params || {}, context)

      // Centralized Receipt/Cleanup logic
      if (context && typeof context.editReply === 'function' && !context.replied) {
        const { MessageFlags } = require('discord.js')
        const isDifferentChannel = (channel && channel.id && context.channelId && channel.id !== context.channelId)

        const silentActions = ['add_reaction', 'remove_reaction']
        const isSilent = silentActions.includes(action.name)

        logger.info(`ActionExecutor: Completed "${action.name}". isDifferentChannel=${isDifferentChannel}, isSilent=${isSilent}`)

        if (isDifferentChannel && !isSilent) {
          const actionDisplayName = action.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
          const channelContext = ` in ${channel.name ? `#${channel.name}` : channel.toString()}`
          await context.editReply({
            content: `✅ **Success:** Executed ${actionDisplayName}${channelContext}`,
            flags: [MessageFlags.SuppressEmbeds]
          }).catch(() => {})
        } else {
          // Same channel OR silent action — let chat.js manage the visible response
          logger.info(`ActionExecutor: Skipping automatic cleanup for "${action.name}" to preserve interaction flow.`)
        }
      }

      if (typeof output === 'object' && output !== null && 'success' in output) {
        return { ...output, output }
      }

      return { success: true, output }
    } catch (err) {
      logger.error(`ActionExecutor: Action "${name}" failed: ${err.message}`)

      // If it's a custom dynamic action, attempt self-healing reflection via high-capability model
      const customFilePath = path.join(CUSTOM_DIR, `${name}.js`)
      if (fs.existsSync(customFilePath)) {
        try {
          const selfHealing = require('./chat/SelfHealingEngine')
          const rawCode = fs.readFileSync(customFilePath, 'utf8')
          const match = rawCode.match(/execute:\s*async\s*\(bot,\s*channel,\s*params(?:,\s*context)?\)\s*=>\s*\{([\s\S]*?)\n {4}\}\n\};/)
          const codeBody = match ? match[1].trim() : rawCode

          const healResult = await selfHealing.healAction({
            actionName: name,
            description: action.description,
            schema: action.schema,
            code: codeBody,
            error: err,
            params
          })

          if (healResult.success) {
            logger.info(`ActionExecutor: Action "${name}" healed successfully. Re-attempting execution...`)
            const reloadedAction = this._actions[name]
            if (reloadedAction) {
              const retryOutput = await reloadedAction.execute(bot, channel, params || {}, context)
              return { success: true, output: retryOutput, healed: true, reasoning: healResult.reasoning }
            }
          }
        } catch (healErr) {
          logger.error(`ActionExecutor: Self-healing attempt failed for "${name}": ${healErr.message}`)
        }
      }

      return { success: false, error: err.message }
    }
  }
}

const actionExecutorInstance = new ActionExecutor()
actionExecutorInstance.FORBIDDEN_PATTERNS = FORBIDDEN_PATTERNS
module.exports = actionExecutorInstance
