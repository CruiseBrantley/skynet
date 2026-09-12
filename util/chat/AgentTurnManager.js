const { jsonrepair } = require('jsonrepair')
const { ActionProgressTracker } = require('./actionProgress')
const logger = require('../../logger')
const telemetry = require('../telemetry')
const ActionExecutor = require('../ActionExecutor')
const agentMemory = require('../AgentMemory')
const SelfHealingEngine = require('./SelfHealingEngine')
const DiscordResponder = require('./DiscordResponder')
const { createMockInteraction } = require('./createMockInteraction')
const { COMMAND_REGEX } = require('./constants')

const MUTATION_TOOLS = new Set([
  'create_slash_command',
  'deploy_slash_commands',
  'manage_command',
  'manage_triggers',
  'manage_workflows',
  'write_state',
  'schedule_task',
  'cancel_task',
  'update_task',
  'send_embed',
  'send_message',
  'send_poll',
  'send_thread',
  'send_gif',
  'add_reaction',
  'remove_reaction',
  'remember',
  'forget'
])

class AgentTurnManager {
  constructor ({ botName = 'Skynet', queryOllamaWithContext = null } = {}) {
    this.botName = botName || process.env.BOT_NAME || 'Skynet'
    this.queryOllamaWithContext = queryOllamaWithContext
  }

  /**
   * Generically determines if the current turn has unfinished work before ending.
   * Uses clear state-based short-circuits, then queries an LLM coordinator evaluation if ambiguous.
   */
  async evaluatePendingWork ({ ollamaContext, executedTools = [], assistantText = '', channelHistory }) {
    const trimmed = (assistantText || '').trim()

    // Deterministic check: Leaked command syntax or unexecuted tool tags are NEVER a sufficient final response
    if (/<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd]|<<<[a-zA-Z0-9_-]+|\{"tool_calls"|<tool_call>/i.test(trimmed)) {
      logger.info('AgentTurnManager: Deterministic pending check: Assistant leaked unexecuted command syntax.')
      return {
        isPending: true,
        isSufficient: false,
        reason: 'Assistant leaked unexecuted tool command syntax instead of answering the question',
        suggestedAction: 'Execute the command or provide a natural answer without command tags'
      }
    }

    // If assistant is explicitly asking the user a clarifying question or confirmation, it is waiting for user input
    if (trimmed.endsWith('?') || /\b(do you want me to|would you like me to|should i|which option|please confirm)\b/i.test(trimmed)) {
      return { isPending: false, isSufficient: true, reason: 'Waiting for user input' }
    }

    // Universal AI Turn Coordinator Reflection:
    try {
      const userPrompt = channelHistory?.messages?.find(m => m.role === 'user')?.content || 'User request'
      const executedNames = executedTools.map(t => (typeof t === 'string' ? t : t.name)).join(', ') || 'None'

      const evaluationPrompt = [
        {
          role: 'system',
          content: 'You are an autonomous AI Turn Coordinator. Analyze whether the Assistant\'s proposed reply is a complete, finished response to the User Request, or if it stopped prematurely with unfinished work, conversational intent promises, or a failure.\n' +
            'Evaluation Rules:\n' +
            '1. "is_sufficient: false" if the Assistant states intent to do work, inspect, check, or fix something (e.g., "I will inspect...", "Let me check...", "I need to look at...", "I will start with..."), but stopped with text commentary without executing the action tool in this turn.\n' +
            '2. "is_sufficient: false" if the Assistant output raw/malformed tool command syntax (e.g. <<<RUN_COMMAND...>>> or unparsed JSON) instead of natural dialogue or an executed tool.\n' +
            '3. "is_sufficient: false" if the user request requires an action or inspection and the Assistant only provided intermediate commentary without completing the task.\n' +
            '4. "is_sufficient: false" (Grounding Failure) if tools were executed to retrieve files, inspect code, or fetch data, but the proposed reply contradicts, ignores, or fails to use the facts from the tool observations.\n' +
            '5. "is_sufficient: true" ONLY when the Assistant has fully and accurately answered/resolved the request using the tool observations, OR when the Assistant is actively blocked and asking the user a direct clarifying question.\n' +
            'Respond ONLY with a valid JSON object matching this schema:\n' +
            '{"is_sufficient": boolean, "reason": "brief explanation", "suggested_action": "what tool, inspection, or step to run next if insufficient"}'
        },
        {
          role: 'user',
          content: `[USER REQUEST]:\n${userPrompt.substring(0, 500)}\n\n` +
            `[TOOLS EXECUTED SO FAR]:\n${executedNames}\n\n` +
            `[ASSISTANT PROPOSED REPLY]:\n${trimmed.substring(0, 800)}\n\n` +
            'Is the proposed reply complete, grounded in the tool observations, and sufficient, or did the assistant stop prematurely, state unexecuted intent, leak command syntax, or leave work pending?'
        }
      ]

      const queryFn = this.queryOllamaWithContext || require('../ollama').queryOllamaWithContext
      const evalResp = await queryFn(evaluationPrompt, { ...ollamaContext, isCodeTask: false }, this.botName)
      const evalContent = evalResp?.message?.content || ''
      const cleanedContent = (evalContent || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()

      const jsonCandidateMatches = cleanedContent.match(/\{[\s\S]*?\}/g) || (cleanedContent ? [cleanedContent] : [])
      for (const rawCandidate of jsonCandidateMatches) {
        try {
          const parsed = JSON.parse(jsonrepair(rawCandidate))
          if (typeof parsed.is_sufficient === 'boolean' || typeof parsed.has_pending_work === 'boolean') {
            const isSufficient = typeof parsed.is_sufficient === 'boolean'
              ? parsed.is_sufficient
              : !parsed.has_pending_work
            const isPending = !isSufficient || Boolean(parsed.has_pending_work)

            logger.info(`AgentTurnManager: LLM Coordinator evaluation: is_sufficient=${isSufficient} (${parsed.reason || 'no reason'})`)
            return {
              isPending,
              isSufficient,
              reason: parsed.reason || (isPending ? 'Turn Coordinator determined response is insufficient' : 'Sufficient reply'),
              suggestedAction: parsed.suggested_action
            }
          }
        } catch (e) {}
      }
    } catch (evalErr) {
      logger.warn(`AgentTurnManager: LLM Coordinator evaluation failed: ${evalErr.message}`)
    }

    // Heuristic fallbacks if LLM evaluation was unavailable or unparseable:
    if (/<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd]|<<<[a-zA-Z0-9_-]+|\{"tool_calls"|<tool_call>/i.test(trimmed)) {
      return {
        isPending: true,
        isSufficient: false,
        reason: 'Assistant leaked unexecuted command syntax instead of answering the question',
        suggestedAction: 'Execute the command or provide a natural answer without command tags'
      }
    }

    if (trimmed.length === 0 || /^(I will|Let me|I'm going to|Checking|Inspecting)[^.!?]*\.\.\.?$/i.test(trimmed)) {
      return {
        isPending: true,
        isSufficient: false,
        reason: 'Assistant gave intermediate intent without answering the question',
        suggestedAction: 'Answer the question directly or execute the required action'
      }
    }

    return { isPending: false, isSufficient: true, reason: 'Default completion' }
  }

  /**
   * Backward-compatible synchronous wrapper around evaluatePendingWork for simple tests/checks.
   */
  hasPendingWork (params) {
    const trimmed = (params.assistantText || '').trim()
    const isActionTask = Boolean(params.ollamaContext?.isCodeTask)
    const hasTools = (params.executedTools || []).length > 0

    if (/<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd]|<<<[a-zA-Z0-9_-]+|\{"tool_calls"|<tool_call>/i.test(trimmed)) {
      return true
    }

    if (!hasTools && !isActionTask) {
      return false
    }

    if (trimmed.endsWith('?') || /\b(do you want me to|would you like me to|should i|which option|please confirm)\b/i.test(trimmed)) {
      return false
    }

    if (isActionTask) {
      const hasMutated = (params.executedTools || []).some(t => MUTATION_TOOLS.has(typeof t === 'string' ? t : t.name))
      if (!hasMutated && ((params.executedTools || []).length > 0 || /```(javascript|js)?[\s\S]*```/i.test(trimmed))) {
        return true
      }
    }

    return false
  }

  /**
   * Generates a clean, typed JSON schema catalog of all available actions.
   */
  static getToolCatalogPrompt (options = {}) {
    const isOwner = Boolean(options && (options.isOwner || options.userId === process.env.OWNER_ID))
    const isPrivate = options ? (!options.guildId || options.isDM) : true

    const actions = ActionExecutor.listActions({ isOwner, isPrivate })
    if (!actions || actions.length === 0) return ''

    const lines = [
      '### TOOL-USE PROTOCOL & REGISTERED TOOLS ###',
      'You have direct access to internal tools and Discord actions.',
      'When you need information or need to take an action, invoke the relevant tool natively using tool calls.',
      '',
      'Available tools:'
    ]

    for (const a of actions) {
      let paramsSummary = '{}'
      if (a.schema && typeof a.schema === 'object') {
        const entries = Object.entries(a.schema).map(([k, rawDef]) => {
          const parsed = typeof ActionExecutor.parseSchemaDefinition === 'function'
            ? ActionExecutor.parseSchemaDefinition(rawDef)
            : rawDef
          const type = parsed.type || 'string'
          const desc = parsed.description ? ' (' + parsed.description + ')' : ''
          return '"' + k + '": "<' + type + desc + '>"'
        })
        paramsSummary = '{ ' + entries.join(', ') + ' }'
      }
      lines.push('- **' + a.name + '**: ' + (a.description || 'Execute action') + '\n  Schema: `{"name": "' + a.name + '", "arguments": ' + paramsSummary + '}`')
    }

    lines.push('\nCRITICAL REACT INSTRUCTIONS:')
    lines.push('1. Never output conversational promises (e.g. "Fixing now...", "Let me update...", "Retrying...") as standalone text without executing the tool in the same message.')
    lines.push('2. If you need to perform an action or retrieve data, call the tool IMMEDIATELY using a tool call.')
    lines.push('3. Only provide plain conversational text when all tool execution is complete and you are delivering the final result.')
    return lines.join('\n')
  }

  /**
   * Sanitizes and compacts tool observations to protect LLM context windows
   * and strip ANSI control characters.
   */
  static sanitizeObservation (rawOutput, { maxLength = 3000 } = {}) {
    if (!rawOutput) return '(No output produced)'
    let text = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput, null, 2)

    // Strip ANSI terminal color and control escape codes
    // eslint-disable-next-line no-control-regex
    text = text.replace(/\u001b\[[0-9;]*m/g, '')

    // Smart head-and-tail compacting for large outputs
    if (text.length > maxLength) {
      const headSize = Math.floor(maxLength * 0.7)
      const tailSize = Math.floor(maxLength * 0.25)
      const omitted = text.length - headSize - tailSize
      text = text.substring(0, headSize) +
        `\n\n... [Output Truncated: ${omitted.toLocaleString()} characters omitted to preserve context window] ...\n\n` +
        text.substring(text.length - tailSize)
    }

    return text.trim()
  }

  /**
   * Extracts one or more structured tool calls from raw model text or native response.
   * Handles native responseData.message.tool_calls, {"tool_calls": [...]}, <tool_call> blocks, <<<RUN_COMMAND>>>, and raw JSON.
   */
  extractToolCalls (text, responseData = null) {
    const results = []

    // 0. Check native tool_calls from responseData (Ollama / OpenAI standard)
    const nativeCalls = responseData?.message?.tool_calls
    if (Array.isArray(nativeCalls) && nativeCalls.length > 0) {
      for (const tc of nativeCalls) {
        const fn = tc.function || tc
        const name = (fn.name || tc.name || '').trim().replace(/^\/+/, '').toLowerCase()
        let args = fn.arguments || tc.arguments || {}
        if (typeof args === 'string') {
          try {
            args = JSON.parse(jsonrepair(args))
          } catch (e) {
            args = {}
          }
        }
        if (name) {
          results.push({ name, arguments: args, rawMatch: JSON.stringify(tc) })
        }
      }
      if (results.length > 0) return results
    }

    if (!text || typeof text !== 'string') return []

    // Helper: Disambiguate duplicate keys like {"command": "host_exec", "command": "ls ..."}
    const disambiguateDuplicateKeys = (rawJson) => {
      let result = rawJson
      for (const key of ['command', 'tool', 'action', 'name']) {
        const keyRegex = new RegExp(`(["']${key}["']\\s*:)`, 'gi')
        let count = 0
        result = result.replace(keyRegex, (match) => {
          count++
          return count > 1 ? `"${key}_arg":` : match
        })
      }
      return result
    }

    // 1. Check for <<<RUN_COMMAND: {...}>>> tags (supports multiple tags and unclosed tags at boundaries)
    const runCommandRegex = /<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd]:?\s*(\{[\s\S]*?)(?:>>>|(?=<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd])|$)/g
    let match
    while ((match = runCommandRegex.exec(text)) !== null) {
      try {
        const rawJsonBlock = match[1].trim()
        const repaired = jsonrepair(disambiguateDuplicateKeys(rawJsonBlock))
        const parsed = JSON.parse(repaired)
        const name = (parsed.command || parsed.tool || parsed.action || parsed.name || '').trim().replace(/^\/+/, '').toLowerCase()
        const args = parsed.params || parsed.arguments || parsed.args || { ...parsed }
        delete args.command
        delete args.tool
        delete args.action
        delete args.name
        delete args.params
        delete args.arguments
        delete args.args

        if (args.command_arg && !args.command) args.command = args.command_arg
        if (args.tool_arg && !args.tool) args.tool = args.tool_arg
        if (args.action_arg && !args.action) args.action = args.action_arg
        if (args.name_arg && !args.name) args.name = args.name_arg
        if (args.cmd && !args.command) args.command = args.cmd

        if (name) {
          results.push({ name, arguments: args, rawMatch: match[0] })
        }
      } catch (e) {
        logger.warn('AgentTurnManager: Failed to parse RUN_COMMAND tag: ' + e.message)
      }
    }

    if (results.length > 0) return results

    // 1b. Check for named RUN_COMMAND format: <<<RUN_COMMAND: <name> {...}>>>
    const namedCommandRegex = /<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd]:?\s*([a-zA-Z0-9_-]+)\s*(\{[\s\S]*?)(?:>>>|(?=<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd])|$)/g
    let namedMatch
    while ((namedMatch = namedCommandRegex.exec(text)) !== null) {
      try {
        const name = namedMatch[1].trim().replace(/^\/+/, '').toLowerCase()
        const repaired = jsonrepair(disambiguateDuplicateKeys(namedMatch[2].trim()))
        const args = JSON.parse(repaired)
        if (name) {
          results.push({ name, arguments: args, rawMatch: namedMatch[0] })
        }
      } catch (e) {
        logger.warn('AgentTurnManager: Failed to parse named RUN_COMMAND tag: ' + e.message)
      }
    }

    if (results.length > 0) return results

    // 2. Check for standard tool_calls object: {"tool_calls": [...]}
    const toolCallRegex = /\{[\s\r\n]*"tool_calls"[\s\r\n]*:\s*(\[[\s\S]*?\])[\s\r\n]*\}/i
    const tcMatch = text.match(toolCallRegex)
    if (tcMatch) {
      try {
        const parsedList = JSON.parse(jsonrepair(tcMatch[1]))
        if (Array.isArray(parsedList)) {
          for (const item of parsedList) {
            const name = (item.name || item.command || item.tool || '').trim().replace(/^\/+/, '').toLowerCase()
            const args = item.arguments || item.params || {}
            if (name) {
              results.push({ name, arguments: args, rawMatch: tcMatch[0] })
            }
          }
        }
      } catch (e) {
        logger.warn('AgentTurnManager: Failed to parse tool_calls list: ' + e.message)
      }
    }

    if (results.length > 0) return results

    // 3. Check for <tool_call>...</tool_call> XML tags
    const xmlRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi
    let xmlMatch
    while ((xmlMatch = xmlRegex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(jsonrepair(disambiguateDuplicateKeys(xmlMatch[1].trim())))
        const name = (parsed.name || parsed.command || parsed.tool || '').trim().replace(/^\/+/, '').toLowerCase()
        const args = parsed.arguments || parsed.params || {}
        if (name) {
          results.push({ name, arguments: args, rawMatch: xmlMatch[0] })
        }
      } catch (e) {
        logger.warn('AgentTurnManager: Failed to parse XML tool_call: ' + e.message)
      }
    }

    if (results.length > 0) return results

    // 4. Fallback: Naked JSON block containing command/tool/action
    const trimmed = text.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const repaired = jsonrepair(disambiguateDuplicateKeys(trimmed))
        const parsed = JSON.parse(repaired)
        const name = (parsed.command || parsed.tool || parsed.action || parsed.name || '').trim().replace(/^\/+/, '').toLowerCase()
        if (name) {
          const args = parsed.params || parsed.arguments || parsed.args || { ...parsed }
          delete args.command
          delete args.tool
          delete args.action
          delete args.name
          delete args.params
          delete args.arguments
          delete args.args

          if (args.command_arg && !args.command) args.command = args.command_arg
          if (args.cmd && !args.command) args.command = args.cmd

          results.push({ name, arguments: args, rawMatch: trimmed })
        }
      } catch (e) {}
    }

    return results
  }

  /**
   * Executes a single tool call with full context, telemetry, and error reporting.
   */
  async executeToolCall ({ name, args, interaction, database, sharedState }) {
    let rawCmdName = name.toLowerCase()
    let isAction = ActionExecutor.hasAction
      ? ActionExecutor.hasAction(rawCmdName)
      : Boolean(ActionExecutor._actions?.[rawCmdName] || (typeof ActionExecutor.listActions === 'function' && ActionExecutor.listActions().some(a => a.name === rawCmdName)) || typeof ActionExecutor.executeAction === 'function')
    const targetCmd = interaction.client?.commands?.get ? interaction.client.commands.get(rawCmdName) : null

    // Special case: built-in memory operations
    if (['remember', 'recall', 'forget'].includes(rawCmdName)) {
      const isOwner = interaction.user?.id === process.env.OWNER_ID
      const isDM = !interaction.guildId
      const targetGuildId = args.guildId || (isOwner && isDM ? null : interaction.guildId)

      if (rawCmdName === 'remember') {
        const key = args.key
        const value = args.value
        const ttl = parseInt(args.ttl_days ?? 30)
        if (key && value !== undefined) {
          agentMemory.set(key, value, ttl, targetGuildId)
          return { success: true, output: '[Memory Stored: "' + key + '" = "' + value + '"]' }
        }
        return { success: false, error: 'Missing key or value for remember.' }
      } else if (rawCmdName === 'recall') {
        const key = args.key
        const val = key ? agentMemory.get(key, targetGuildId) : null
        return { success: true, output: val ? '[Memory Retrieved: "' + key + '" = "' + val + '"]' : '[No memory found for "' + key + '"]' }
      } else if (rawCmdName === 'forget') {
        const key = args.key
        const success = key ? agentMemory.delete(key) : false
        return { success: true, output: success ? '[Memory Deleted: "' + key + '"]' : '[No memory found for "' + key + '"]' }
      }
    }

    if (!isAction && !targetCmd) {
      const isOwner = Boolean(
        interaction.user?.id === process.env.OWNER_ID ||
        interaction.userId === process.env.OWNER_ID
      )
      const isPrivate = !interaction.guildId || interaction.isDM || interaction.clientId === 'web' || interaction.clientId === 'cli'
      if ((isOwner || isPrivate) && (/\b(ls|cd|git|find|grep|cat|npm|node|head|tail|echo|pwd|rm|cp|mv|curl|which|sh|zsh|bash)\b/i.test(rawCmdName) || /[|&;><]/.test(rawCmdName))) {
        logger.info(`AgentTurnManager: Interpreting unrecognized tool "${rawCmdName}" as host_exec invocation`)
        args = {
          command: args?.command || args?.cmd || args?.command_arg || rawCmdName,
          cwd: args?.cwd
        }
        rawCmdName = 'host_exec'
        isAction = true
      } else {
        return { success: false, error: 'Unknown tool or command: "' + rawCmdName + '".' }
      }
    }

    const visualActions = ['send_embed', 'send_poll', 'send_message', 'send_thread', 'add_reaction', 'remove_reaction']
    if (visualActions.includes(rawCmdName)) {
      sharedState.visualActionExecuted = true
    }

    const targetChannel = interaction.channel
    const mock = createMockInteraction(interaction, {
      params: args || {},
      channel: targetChannel
    }, null, sharedState)

    const { getParam } = require('../commandHelper')
    const resolveParam = (n) => {
      if (args && args[n] !== undefined) return args[n]
      if (args && args.params && args.params[n] !== undefined) return args.params[n]
      if (n === 'title' && (args?.add || args?.remove)) return args.add || args.remove
      return getParam(args, n)
    }

    mock.options = {
      getString: (n) => {
        const v = resolveParam(n)
        return v !== null && v !== undefined ? String(v) : null
      },
      getSubcommand: () => {
        const direct = resolveParam('subcommand')
        if (direct) return direct
        if (args?.add !== undefined) return 'add'
        if (args?.remove !== undefined) return 'remove'
        if (args?.list !== undefined) return 'list'
        if (args?.sync !== undefined) return 'sync'
        if (args?.seed !== undefined) return 'seed'
        if (args?.auth !== undefined) return 'auth'
        return null
      },
      getSubcommandGroup: () => resolveParam('subcommand_group') || null,
      getChannel: (n) => {
        const val = resolveParam(n)
        if (!val) return null
        const id = String(val).replace(/[<#>]/g, '')
        return interaction.client?.channels?.cache?.get ? interaction.client.channels.cache.get(id) || null : null
      },
      getBoolean: (n) => {
        const val = resolveParam(n)
        return val === true || val === 'true' || val === 1 || val === '1'
      },
      getInteger: (n) => {
        const val = resolveParam(n)
        return val !== null && val !== undefined ? parseInt(val, 10) : null
      },
      getUser: (n) => {
        const val = resolveParam(n)
        if (!val) return null
        const id = String(val).replace(/[<@!>]/g, '')
        return interaction.client?.users?.cache?.get ? interaction.client.users.cache.get(id) || null : null
      },
      getAttachment: () => null,
      getMember: () => null
    }

    const startEpoch = Date.now()

    if (isAction) {
      const isOwner = Boolean(
        interaction.isOwner ||
        interaction.user?.id === process.env.OWNER_ID ||
        interaction.userId === process.env.OWNER_ID
      )
      const isDM = Boolean(
        !interaction.guildId ||
        interaction.channel?.type === 1 ||
        interaction.isDM ||
        interaction.clientId === 'web' ||
        interaction.clientId === 'cli'
      )

      const actionContext = {
        interaction: mock,
        channel: targetChannel,
        client: interaction.client,
        guild: interaction.guild,
        userId: interaction.user?.id || interaction.userId,
        guildId: interaction.guildId,
        channelId: targetChannel?.id,
        member: interaction.member,
        user: interaction.user,
        isOwner,
        isDM,
        clientId: interaction.clientId,
        isInteractive: true,
        isScheduled: false
      }

      const result = await ActionExecutor.executeAction(rawCmdName, args, actionContext)
      if (result.success) sharedState.primaryResponseUsed = true

      telemetry.trackCommandExecution({
        commandName: rawCmdName,
        type: 'action',
        guildId: interaction.guildId || 'DM',
        guildName: interaction.guild?.name || (interaction.guildId ? 'Server' : 'Direct Message'),
        channelId: targetChannel?.id,
        userId: interaction.user?.id,
        username: interaction.user?.tag || interaction.user?.username,
        success: result.success,
        error: result.error,
        durationMs: Date.now() - startEpoch
      }).catch(() => {})

      if (!result.success) {
        const actionObj = ActionExecutor._actions?.[rawCmdName]
        if (actionObj) {
          SelfHealingEngine.proposeActionFix({
            actionName: rawCmdName,
            description: actionObj.description,
            schema: actionObj.schema,
            code: actionObj.execute?.toString() || '',
            error: result.error,
            params: args,
            interaction,
            client: interaction.client
          }).catch(e => logger.warn('Action repair proposal failed: ' + e.message))
        }
      }

      const outputStr = typeof result.output === 'string' ? result.output : JSON.stringify(result.output)
      return {
        success: result.success,
        output: result.success ? (outputStr || 'Action executed successfully.') : 'Action failed: ' + result.error,
        error: result.error
      }
    } else {
      // Execute standard Discord slash command
      try {
        sharedState.primaryResponseUsed = true
        const output = await targetCmd.execute(mock, database)
        telemetry.trackCommandExecution({
          commandName: rawCmdName,
          type: 'autonomous',
          guildId: interaction.guildId || 'DM',
          guildName: interaction.guild?.name || (interaction.guildId ? 'Server' : 'Direct Message'),
          channelId: targetChannel?.id,
          userId: interaction.user?.id,
          username: interaction.user?.tag || interaction.user?.username,
          success: true,
          durationMs: Date.now() - startEpoch
        }).catch(() => {})

        return {
          success: true,
          output: typeof output === 'string' ? output : 'Command /' + rawCmdName + ' completed.'
        }
      } catch (err) {
        telemetry.trackCommandExecution({
          commandName: rawCmdName,
          type: 'autonomous',
          guildId: interaction.guildId || 'DM',
          guildName: interaction.guild?.name || (interaction.guildId ? 'Server' : 'Direct Message'),
          channelId: targetChannel?.id,
          userId: interaction.user?.id,
          username: interaction.user?.tag || interaction.user?.username,
          success: false,
          error: err,
          durationMs: Date.now() - startEpoch
        }).catch(() => {})

        SelfHealingEngine.proposeSlashCommandFix({
          commandName: rawCmdName,
          error: err,
          interaction,
          client: interaction.client
        }).catch(e => logger.warn('Slash command repair proposal failed: ' + e.message))

        return {
          success: false,
          output: 'Error executing /' + rawCmdName + ': ' + err.message,
          error: err.message
        }
      }
    }
  }

  /**
   * Main ReAct Execution Loop.
   * Runs model reasoning and tool execution until a natural completion is reached.
   */
  async executeTurn ({
    interaction,
    database,
    channelHistory,
    ollamaContext,
    maxSteps = 25
  }) {
    const sharedState = {
      primaryResponseUsed: false,
      primaryContent: null,
      visualActionExecuted: false
    }

    const executedTools = []
    const executedSignatures = new Set()
    const highImpactExecuted = new Set()
    const highImpactActions = new Set(['send_embed', 'send_poll', 'summarize_history'])

    let lastToolSignature = ''
    let consecutiveSameToolCount = 0
    let pendingPromptCount = 0
    let finalReplyContent = ''

    // Determine authorization scope for tool catalog and native tools schema
    const isOwner = Boolean(
      interaction.user?.id === process.env.OWNER_ID ||
      interaction.userId === process.env.OWNER_ID
    )
    const isPrivate = !interaction.guildId || interaction.isDM || interaction.clientId === 'web' || interaction.clientId === 'cli'
    const availableToolsSchema = typeof ActionExecutor.getOllamaToolsSchema === 'function'
      ? ActionExecutor.getOllamaToolsSchema({ isOwner, isPrivate })
      : []

    const tracker = new ActionProgressTracker({ botName: this.botName })
    if (!sharedState.primaryResponseUsed && typeof interaction.showStatus === 'function') {
      await interaction.showStatus(`${this.botName} is thinking...`).catch(() => {})
    }

    for (let step = 0; step < maxSteps; step++) {
      logger.info(`AgentTurnManager: Executing turn step ${step + 1}/${maxSteps}`)

      if (typeof interaction.resetStream === 'function') {
        interaction.resetStream()
      } else if (typeof interaction.streamToken?.reset === 'function') {
        interaction.streamToken.reset()
      }

      // Stream Isolation: During tool planning turns, isolate streaming from primary message
      const queryFn = this.queryOllamaWithContext || require('../ollama').queryOllamaWithContext
      const turnContext = {
        ...ollamaContext,
        tools: availableToolsSchema
      }

      const responseData = await queryFn(
        [...channelHistory.messages],
        turnContext,
        this.botName,
        null // Suppress direct message streaming during planning/tool execution
      )

      if (!responseData || !responseData.message) {
        throw new Error('Invalid response from AI model engine.')
      }

      const rawContent = responseData.message.content || ''
      const toolCalls = this.extractToolCalls(rawContent, responseData)

      // ─────────────────────────────────────────────────────────────
      // Case A: Model output has NO tool calls -> Final Answer Turn
      // ─────────────────────────────────────────────────────────────
      if (toolCalls.length === 0) {
        let candidateReply = rawContent.replace(COMMAND_REGEX, '').trim()

        // If tools executed without a visual action, but model stopped with empty text, trigger dedicated synthesis
        if (executedTools.length > 0 && !sharedState.visualActionExecuted && !candidateReply) {
          logger.info(`AgentTurnManager: Step ${step + 1} concluded tool execution. Entering dedicated synthesis phase.`)
          channelHistory.messages.push({
            role: 'user',
            content: '[SYSTEM DIRECTIVE: All requested actions and inspections are complete. You are now in the FINAL SYNTHESIS phase. Formulate a direct, grounded, and comprehensive response to the user based on the tool observations. Do not output any more tool calls or command tags.]'
          })

          if (typeof interaction.resetStream === 'function') {
            interaction.resetStream()
          } else if (typeof interaction.streamToken?.reset === 'function') {
            interaction.streamToken.reset()
          }

          const synthStream = interaction.streamToken || interaction.onToken || null
          const synthResponse = await queryFn(
            [...channelHistory.messages],
            { ...ollamaContext, tools: [] },
            this.botName,
            synthStream
          )
          candidateReply = (synthResponse?.message?.content || '').replace(COMMAND_REGEX, '').trim()
        }

        finalReplyContent = candidateReply

        const pendingEval = await this.evaluatePendingWork({
          ollamaContext,
          executedTools,
          assistantText: finalReplyContent || rawContent,
          channelHistory
        })

        if (pendingEval.isPending && pendingPromptCount < 2 && step < maxSteps - 1) {
          pendingPromptCount++
          logger.info(`AgentTurnManager: Pending work, ungrounded reply, or insufficient response detected at step ${step + 1} ("${(finalReplyContent || rawContent).slice(0, 80)}..."). Reason: ${pendingEval.reason}. Prompting model to complete work (retry #${pendingPromptCount}).`)
          channelHistory.messages.push({ role: 'assistant', content: finalReplyContent || rawContent })

          let directive = `[SYSTEM COORDINATOR FEEDBACK: Your previous reply was determined to be insufficient, incomplete, or ungrounded. Reason: ${pendingEval.reason}.`
          if (pendingEval.suggestedAction) {
            directive += ` Action required: ${pendingEval.suggestedAction}.`
          } else {
            directive += ' If an action or tool is needed, invoke the required tool now. Otherwise, provide a complete, grounded response to the user.'
          }
          directive += ']'

          channelHistory.messages.push({
            role: 'user',
            content: directive
          })
          continue
        }

        // If retries exhausted or step limit reached, but response is still pending or contains command syntax
        if (pendingEval.isPending || /<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd]|<<<[a-zA-Z0-9_-]+|\{"tool_calls"|<tool_call>/i.test(finalReplyContent)) {
          if (!finalReplyContent && sharedState.visualActionExecuted) {
            // Intentional silent completion for visual actions (e.g. embed/poll displayed)
          } else {
            logger.warn(`AgentTurnManager: Step ${step + 1} produced insufficient response or leaked tool syntax after retries. Suppressing invalid final reply.`)
            finalReplyContent = 'I was unable to complete the requested actions to answer your question. Please try again or rephrase.'
          }
        }

        if (finalReplyContent) {
          channelHistory.messages.push({ role: 'assistant', content: finalReplyContent })
        }
        logger.info(`AgentTurnManager: Natural completion reached at step ${step + 1}. Final reply length: ${finalReplyContent.length}`)
        break
      }

      // ─────────────────────────────────────────────────────────────
      // Case B: Model called one or more tools -> Execution Turn
      // ─────────────────────────────────────────────────────────────
      logger.info(`AgentTurnManager: Step ${step + 1} extracted ${toolCalls.length} tool calls: ${toolCalls.map(t => t.name).join(', ')}`)

      // Clean assistant message to record in history
      const cleanAssistantText = rawContent.replace(COMMAND_REGEX, '').trim()
      channelHistory.messages.push({ role: 'assistant', content: cleanAssistantText || rawContent })

      for (const toolCall of toolCalls) {
        const toolSig = `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`

        // Check strict duplicate execution within same turn
        if (executedSignatures.has(toolSig)) {
          logger.info(`AgentTurnManager: Skipping duplicate tool execution for identical signature: ${toolSig}`)
          channelHistory.messages.push({
            role: 'user',
            content: `[TOOL OBSERVATION for "${toolCall.name}"]: Skipped duplicate execution — identical action already executed in this turn.`
          })
          continue
        }

        // Check high-impact command budgeting (e.g. max 1 embed/poll per turn)
        if (highImpactActions.has(toolCall.name)) {
          if (highImpactExecuted.has(toolCall.name)) {
            logger.info(`AgentTurnManager: Skipping repeated high-impact action: ${toolCall.name}`)
            channelHistory.messages.push({
              role: 'user',
              content: `[TOOL OBSERVATION for "${toolCall.name}"]: Budget limit reached for ${toolCall.name} in this turn.`
            })
            continue
          }
          highImpactExecuted.add(toolCall.name)
        }

        // Smart Loop / Cycle Detection
        if (toolSig === lastToolSignature) {
          consecutiveSameToolCount++
        } else {
          lastToolSignature = toolSig
          consecutiveSameToolCount = 1
        }

        if (consecutiveSameToolCount >= 3) {
          logger.warn(`AgentTurnManager: Cycle detected for tool "${toolCall.name}". Forcing conclusion.`)
          channelHistory.messages.push({
            role: 'user',
            content: `[SYSTEM: Loop cycle detected: Tool "${toolCall.name}" was called 3 times consecutively with identical arguments. Do not call it again. Formulate your final response to the user now.]`
          })
          continue
        }

        executedSignatures.add(toolSig)

        tracker.startAction(toolCall.name, toolCall.arguments)
        if (!sharedState.primaryResponseUsed && typeof interaction.showStatus === 'function') {
          const statusText = interaction.isWeb ? tracker.renderWebStatus() : tracker.renderDiscordProgress()
          await interaction.showStatus(statusText).catch(() => {})
        }

        const executionResult = await this.executeToolCall({
          name: toolCall.name,
          args: toolCall.arguments,
          interaction,
          database,
          sharedState
        })

        executedTools.push({
          name: toolCall.name,
          arguments: toolCall.arguments,
          success: executionResult.success
        })

        tracker.finishAction(toolCall.name, executionResult.success)
        if (!sharedState.primaryResponseUsed && typeof interaction.showStatus === 'function') {
          const statusText = interaction.isWeb ? tracker.renderWebStatus() : tracker.renderDiscordProgress()
          await interaction.showStatus(statusText).catch(() => {})
        }

        // Sanitize observation and feed back into context
        const sanitizedOutput = AgentTurnManager.sanitizeObservation(executionResult.output)
        channelHistory.messages.push({
          role: 'user',
          content: `[TOOL OBSERVATION for "${toolCall.name}"]:\n${sanitizedOutput}\n\nReview this result. If more tools are needed to fulfill the user's request, call them now. Otherwise, synthesize your complete response.`
        })
      }
    }

    // Resolve @mentions back to <@ID> using persistent mention resolver
    if (finalReplyContent) {
      const mentionResolver = require('../MentionResolver')
      finalReplyContent = mentionResolver.resolve(finalReplyContent, interaction.guildId)
    }

    try {
      // Deliver final formatted response to Discord
      const responder = new DiscordResponder({ botName: this.botName })
      await responder.sendFinalResponse({
        interaction,
        replyContent: finalReplyContent,
        sharedState
      })

      // Ephemeral Turn Scratchpad Hygiene:
      // Retain only the initial user prompt, system prompt, and final assistant response
      // to prevent intermediate JSON/HTML dumps from inflating future conversation context.
      if (channelHistory?.messages) {
        channelHistory.messages = channelHistory.messages.filter((msg, idx) => {
          return idx === 0 || msg.role === 'user' || msg.role === 'assistant'
        })
      }

      return {
        success: true,
        replyContent: finalReplyContent,
        executedTools
      }
    } finally {
      if (typeof interaction.cleanup === 'function') {
        interaction.cleanup()
      }
    }
  }
}

module.exports = AgentTurnManager
