const { MessageFlags } = require('discord.js')
const { jsonrepair } = require('jsonrepair')
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

    // If assistant is explicitly asking the user a clarifying question or confirmation, it is waiting for user input
    if (trimmed.endsWith('?') || /\b(do you want me to|would you like me to|should i|which option|please confirm)\b/i.test(trimmed)) {
      return { isPending: false, reason: 'Waiting for user input' }
    }

    // Universal AI Turn Coordinator Reflection:
    try {
      const userPrompt = channelHistory?.messages?.find(m => m.role === 'user')?.content || 'User request'
      const executedNames = executedTools.map(t => (typeof t === 'string' ? t : t.name)).join(', ') || 'None'

      const evaluationPrompt = [
        {
          role: 'system',
          content: 'You are an autonomous AI Turn Coordinator. Analyze whether the Assistant has completely fulfilled the User Request or if it stopped prematurely with pending intentions, promises, or unfinished tool executions.\n' +
            'Respond ONLY with a valid JSON object matching this schema:\n' +
            '{"has_pending_work": boolean, "reason": "brief explanation", "suggested_action": "what tool or step to run next if pending"}'
        },
        {
          role: 'user',
          content: `[USER REQUEST]:\n${userPrompt.substring(0, 500)}\n\n` +
            `[TOOLS EXECUTED SO FAR]:\n${executedNames}\n\n` +
            `[ASSISTANT PROPOSED REPLY]:\n${trimmed.substring(0, 800)}\n\n` +
            'Has the assistant finished the task, or is there pending work / unexecuted intent?'
        }
      ]

      const queryFn = this.queryOllamaWithContext || require('../ollama').queryOllamaWithContext
      const evalResp = await queryFn(evaluationPrompt, { ...ollamaContext, isCodeTask: false }, this.botName)
      const evalContent = evalResp?.message?.content || ''
      const evalJsonMatch = evalContent.match(/\{[\s\S]*\}/)

      if (evalJsonMatch) {
        const parsed = JSON.parse(jsonrepair(evalJsonMatch[0]))
        if (typeof parsed.has_pending_work === 'boolean') {
          logger.info(`AgentTurnManager: LLM Coordinator evaluation: has_pending_work=${parsed.has_pending_work} (${parsed.reason || 'no reason'})`)
          return {
            isPending: parsed.has_pending_work,
            reason: parsed.reason || 'LLM Coordinator evaluation',
            suggestedAction: parsed.suggested_action
          }
        }
      }
    } catch (evalErr) {
      logger.warn(`AgentTurnManager: LLM Coordinator evaluation failed: ${evalErr.message}`)
    }

    return { isPending: false, reason: 'Default completion' }
  }

  /**
   * Backward-compatible synchronous wrapper around evaluatePendingWork for simple tests/checks.
   */
  hasPendingWork (params) {
    const trimmed = (params.assistantText || '').trim()
    const isActionTask = Boolean(params.ollamaContext?.isCodeTask)
    const hasTools = (params.executedTools || []).length > 0

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
  static getToolCatalogPrompt () {
    const actions = ActionExecutor.listActions()
    if (!actions || actions.length === 0) return ''

    const lines = [
      '### TOOL-USE PROTOCOL & REGISTERED TOOLS ###',
      'You have direct access to internal tools and Discord actions.',
      'When you need information or need to take an action, output a single structured tool call block:',
      '```json',
      '{"tool_calls": [{"name": "tool_name", "arguments": {"param1": "value1"}}]}',
      '```',
      'Or output: <<<RUN_COMMAND: {"command": "tool_name", "params": {"param1": "value1"}}>>>',
      '',
      'Available tools:'
    ]

    for (const a of actions) {
      let paramsSummary = '{}'
      if (a.schema && typeof a.schema === 'object') {
        const entries = Object.entries(a.schema).map(([k, v]) => {
          const type = v.type || 'string'
          const desc = v.description ? ' (' + v.description + ')' : ''
          return '"' + k + '": "<' + type + desc + '>"'
        })
        paramsSummary = '{ ' + entries.join(', ') + ' }'
      }
      lines.push('- **' + a.name + '**: ' + (a.description || 'Execute action') + '\n  Schema: `{"name": "' + a.name + '", "arguments": ' + paramsSummary + '}`')
    }

    lines.push('\nCRITICAL REACT INSTRUCTIONS:')
    lines.push('1. Never output conversational promises (e.g. "Fixing now...", "Let me update...", "Retrying...") as standalone text without executing the tool in the same message.')
    lines.push('2. If you need to perform an action or retrieve data, call the tool IMMEDIATELY using `<<<RUN_COMMAND: {"command": "...", ...}>>>`.')
    lines.push('3. Only provide plain conversational text when all tool execution is complete and you are delivering the final result.')
    return lines.join('\n')
  }

  /**
   * Extracts one or more structured tool calls from raw model text.
   * Handles {"tool_calls": [...]}, <tool_call> blocks, <<<RUN_COMMAND>>>, and raw JSON.
   */
  extractToolCalls (text) {
    if (!text || typeof text !== 'string') return []
    const results = []

    // 1. Check for <<<RUN_COMMAND: {...}>>> tags (supports multiple tags)
    const runCommandRegex = /<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd]:\s*(\{[\s\S]*?\})\s*>>>/g
    let match
    while ((match = runCommandRegex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(jsonrepair(match[1]))
        const name = (parsed.command || parsed.tool || parsed.action || parsed.name || '').trim().replace(/^\/+/, '').toLowerCase()
        const args = parsed.params || parsed.arguments || parsed.args || { ...parsed }
        delete args.command
        delete args.tool
        delete args.action
        delete args.name
        delete args.params
        delete args.arguments
        delete args.args

        if (name) {
          results.push({ name, arguments: args, rawMatch: match[0] })
        }
      } catch (e) {
        logger.warn('AgentTurnManager: Failed to parse RUN_COMMAND tag: ' + e.message)
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
        const parsed = JSON.parse(jsonrepair(xmlMatch[1].trim()))
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
        const parsed = JSON.parse(jsonrepair(trimmed))
        const name = (parsed.command || parsed.tool || parsed.action || parsed.name || '').trim().replace(/^\/+/, '').toLowerCase()
        if (name) {
          const args = parsed.params || parsed.arguments || { ...parsed }
          delete args.command
          delete args.tool
          delete args.action
          delete args.name
          delete args.params
          delete args.arguments
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
    const rawCmdName = name.toLowerCase()
    const allActions = ActionExecutor.listActions()
    const isAction = allActions.some(a => a.name === rawCmdName)
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
      return { success: false, error: 'Unknown tool or command: "' + rawCmdName + '".' }
    }

    const visualActions = ['send_embed', 'send_poll', 'send_message', 'send_thread', 'add_reaction', 'remove_reaction']
    if (visualActions.includes(rawCmdName)) {
      sharedState.visualActionExecuted = true
    }

    if (!sharedState.primaryResponseUsed && typeof interaction.editReply === 'function') {
      try {
        await interaction.editReply({
          content: `*${this.botName} is executing \`${rawCmdName}\`...*`,
          flags: [MessageFlags.SuppressEmbeds]
        })
      } catch (e) {}
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
      return getParam(args, n)
    }

    mock.options = {
      getString: (n) => {
        const v = resolveParam(n)
        return v !== null && v !== undefined ? String(v) : null
      },
      getSubcommand: () => resolveParam('subcommand') || null,
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
      const actionContext = {
        interaction: mock,
        channel: targetChannel,
        client: interaction.client,
        guild: interaction.guild,
        userId: interaction.user?.id,
        guildId: interaction.guildId,
        channelId: targetChannel?.id,
        member: interaction.member,
        user: interaction.user
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

    for (let step = 0; step < maxSteps; step++) {
      logger.info(`AgentTurnManager: Executing turn step ${step + 1}/${maxSteps}`)

      const queryFn = this.queryOllamaWithContext || require('../ollama').queryOllamaWithContext
      const responseData = await queryFn(
        [...channelHistory.messages],
        ollamaContext,
        this.botName
      )

      if (!responseData || !responseData.message) {
        throw new Error('Invalid response from AI model engine.')
      }

      const rawContent = responseData.message.content || ''
      const toolCalls = this.extractToolCalls(rawContent)

      // ─────────────────────────────────────────────────────────────
      // Case A: Model output has NO tool calls -> Final Answer Turn
      // ─────────────────────────────────────────────────────────────
      if (toolCalls.length === 0) {
        finalReplyContent = rawContent.replace(COMMAND_REGEX, '').trim()

        const pendingEval = await this.evaluatePendingWork({
          ollamaContext,
          executedTools,
          assistantText: finalReplyContent,
          channelHistory
        })

        if (pendingEval.isPending && pendingPromptCount < 2 && step < maxSteps - 1) {
          pendingPromptCount++
          logger.info(`AgentTurnManager: Pending work detected at step ${step + 1} ("${finalReplyContent.slice(0, 80)}..."). Reason: ${pendingEval.reason}. Prompting model to execute action (retry #${pendingPromptCount}).`)
          channelHistory.messages.push({ role: 'assistant', content: finalReplyContent })

          const isCode = Boolean(ollamaContext?.isCodeTask)
          let directive = isCode
            ? '[SYSTEM COORDINATOR: You stated intent or drafted code commentary without executing. Do not end the turn with commentary. Output the executable <<<RUN_COMMAND: {"command": "create_slash_command", "name": "...", "description": "...", "code": "..."}>>> or action tool now to apply the changes.]'
            : '[SYSTEM COORDINATOR: You diagnosed the state or stated intent. Do not stop with text commentary. Proceed to execute the necessary action tool now using <<<RUN_COMMAND: {"command": "...", ...}>>> to complete the request.]'

          if (pendingEval.suggestedAction) {
            directive += ` Recommended next action: ${pendingEval.suggestedAction}`
          }

          channelHistory.messages.push({
            role: 'user',
            content: directive
          })
          continue
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

        // Feed structured tool observation back into context
        channelHistory.messages.push({
          role: 'user',
          content: `[TOOL OBSERVATION for "${toolCall.name}"]:\n${executionResult.output}\n\nReview this result. If more tools are needed to fulfill the user's request, call them now. Otherwise, synthesize your complete response.`
        })
      }
    }

    // Resolve @mentions back to <@ID> using persistent mention resolver
    if (finalReplyContent) {
      const mentionResolver = require('../MentionResolver')
      finalReplyContent = mentionResolver.resolve(finalReplyContent, interaction.guildId)
    }

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
  }
}

module.exports = AgentTurnManager
