const { MessageFlags } = require('discord.js')
const { jsonrepair } = require('jsonrepair')
const logger = require('../../logger')

const { COMMAND_REGEX } = require('./constants')
const { createMockInteraction } = require('./createMockInteraction')

class AutonomousCommandProcessor {
  constructor ({ botName, ActionExecutor, agentMemory, queryOllamaWithContext, getParam }) {
    this.botName = botName || 'Bot'
    this.ActionExecutor = ActionExecutor
    this.agentMemory = agentMemory
    this.queryOllamaWithContext = queryOllamaWithContext
    this.getParam = getParam
  }

  async process ({ interaction, database, channelHistory, replyContent, sharedState, ollamaContext }) {
    const executedCommands = new Set()
    const executedJson = new Set() // Prevent exact same JSON from running twice in one turn
    let loopCount = 0

    while (loopCount < 10) {
      if (!replyContent || typeof replyContent !== 'string') break

      const commandMatch = replyContent.match(COMMAND_REGEX)
      let jsonStr = ''
      let fullMatchString = ''

      if (commandMatch) {
        fullMatchString = commandMatch[0]
        jsonStr = commandMatch[1]
      } else {
        // Fallback: If no tags, did the AI just output a naked JSON block?
        const isPotentialJson = replyContent.trim().startsWith('{') && replyContent.trim().endsWith('}')
        if (isPotentialJson && !replyContent.includes('<<<RUN_COMMAND')) {
          try {
            const candidate = replyContent.trim()
            const testData = JSON.parse(jsonrepair(candidate))
            // Alias 'tool' or 'action' to 'command' for LLMs that hallucinate standard tool calling JSON
            if (testData.tool && !testData.command) testData.command = testData.tool
            if (testData.action && !testData.command) testData.command = testData.action

            if (testData.command) {
              jsonStr = JSON.stringify(testData)
              fullMatchString = replyContent
              logger.info(`AUTONOMOUS: Detected naked JSON: ${jsonStr.substring(0, 100)}`)
            }
          } catch (e) {}
        }
      }

      if (!jsonStr) break

      loopCount++
      try {
        const cmdData = JSON.parse(jsonrepair(jsonStr))

        // Remove the command tag (or naked JSON) from the visible reply AND the persistent history
        replyContent = replyContent.replace(fullMatchString, '').trim()
        const lastMsg = channelHistory.messages[channelHistory.messages.length - 1]
        if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.content = lastMsg.content.replace(fullMatchString, '').trim()
        }

        const rawCmdName = (cmdData.command || '').trim().replace(/^\/+/, '').toLowerCase()
        const allActions = this.ActionExecutor.listActions()
        const isAction = allActions.some(a => a.name === rawCmdName)

        // Smart Budgeting: Prevent spam of major actions within a single user request turn.
        // Whitelist minor utility commands that can naturally be multi-fired.
        const multiFireWhitelist = [
          'add_reaction', 'remove_reaction', 'remember', 'forget', 'search', 'web_search',
          'create_action', 'modify_action', 'delete_action',
          'create_slash_command', 'disable_slash_command', 'enable_slash_command', 'list_slash_commands', 'inspect_slash_command',
          'manage_command'
        ]
        const highImpactCommands = ['send_embed', 'send_poll', 'summarize_history']
        const visualActions = ['send_embed', 'send_poll', 'summarize_history', 'add_reaction', 'remove_reaction']

        const normalizedJson = JSON.stringify(cmdData)
        if (executedJson.has(normalizedJson)) {
          logger.warn('AUTONOMOUS: Blocking identical re-execution of command in this turn.')
          continue
        }

        if (executedCommands.has(rawCmdName) && !multiFireWhitelist.includes(rawCmdName)) {
          logger.warn(`AUTONOMOUS: Blocking redundant execution of ${rawCmdName} in this turn.`)
          continue
        }

        if (highImpactCommands.includes(rawCmdName)) {
          if (sharedState.highImpactCount >= 1) {
            logger.warn(`AUTONOMOUS: High-impact command budget exceeded (${rawCmdName}). Blocking execution.`)
            const actionResult = '[SYSTEM: Error - Command budget exceeded for this turn. You have already executed a major action. Do NOT attempt to run more high-impact commands during this specific turn.]'
            channelHistory.messages.push({ role: 'system', content: actionResult })
            continue
          }
          sharedState.highImpactCount++
        }

        executedCommands.add(rawCmdName)
        executedJson.add(normalizedJson)
        if (visualActions.includes(rawCmdName)) {
          sharedState.visualActionExecuted = true
        }

        // Identify the parameters. If they are nested in 'params', use that.
        // Otherwise, use all keys EXCEPT 'command' as the parameters.
        let params = cmdData.params
        if (!params || typeof params !== 'object') {
          const { command, ...rest } = cmdData
          params = rest
        }

        // Special case: Top-Level Discord Slash Command Management
        if (['create_slash_command', 'disable_slash_command', 'enable_slash_command', 'list_slash_commands', 'inspect_slash_command'].includes(rawCmdName)) {
          const commandManager = require('../commandManager')
          const cmdName = (cmdData.name || params.name || '').trim().toLowerCase().replace(/^\/+/, '')
          const description = cmdData.description || params.description || ''
          const code = cmdData.code || params.code || ''
          const botClient = interaction.client

          const { PermissionFlagsBits } = require('discord.js')
          const isOwner = interaction.user?.id === process.env.OWNER_ID
          const isDM = !interaction.guildId
          const isAdmin = isOwner || isDM || Boolean(
            interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator) ||
            interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild) ||
            interaction.member?.permissions?.has?.(PermissionFlagsBits.Administrator)
          )
          const isRestricted = ['disable_slash_command', 'enable_slash_command'].includes(rawCmdName)

          let slashResult = ''
          if (isRestricted && !isOwner && !isDM) {
            slashResult = '[SYSTEM: Error - Removing or disabling slash commands is restricted to the bot creator.]'
          } else if (rawCmdName === 'create_slash_command') {
            if (!isAdmin && !isDM) {
              slashResult = '[SYSTEM: Error - Creating slash commands in a server requires Administrator or Manage Server permissions.]'
            } else {
              const options = cmdData.options || params.options || null
              const isGlobal = isOwner && (isDM || Boolean(cmdData.global || params.global))
              const targetGuild = isGlobal ? null : interaction.guildId
              const res = await commandManager.createSlashCommand({
                name: cmdName,
                description,
                options,
                code,
                bot: botClient,
                guildId: targetGuild,
                isGlobal,
                userId: interaction.user?.id
              })
              if (res.success) {
                const scopeMsg = targetGuild ? `scoped to this server (Guild ID: ${targetGuild})` : 'globally across all servers'
                slashResult = `[SYSTEM: Successfully created and deployed slash command "/${cmdName}" ${scopeMsg} live on Discord.]`
              } else {
                slashResult = `[SYSTEM: Failed to create slash command "/${cmdName}": ${res.error}]`
              }
            }
          } else if (rawCmdName === 'disable_slash_command') {
            const res = await commandManager.disableSlashCommand(cmdName, botClient)
            slashResult = res.success ? `[SYSTEM: Successfully disabled slash command "/${cmdName}" and removed from Discord UI.]` : `[SYSTEM: Failed to disable "/${cmdName}": ${res.error}]`
          } else if (rawCmdName === 'enable_slash_command') {
            const res = await commandManager.enableSlashCommand(cmdName, botClient)
            slashResult = res.success ? `[SYSTEM: Successfully enabled slash command "/${cmdName}" and registered on Discord.]` : `[SYSTEM: Failed to enable "/${cmdName}": ${res.error}]`
          } else if (rawCmdName === 'list_slash_commands') {
            const list = commandManager.listSlashCommands()
            const active = list.filter(c => c.enabled).map(c => `/${c.name}`).join(', ')
            const disabled = list.filter(c => !c.enabled).map(c => `/${c.name} (disabled)`).join(', ')
            slashResult = `[SYSTEM: Active Slash Commands on Discord: ${active || 'None'}. Disabled: ${disabled || 'None'}.]`
          } else if (rawCmdName === 'inspect_slash_command') {
            const res = commandManager.inspectSlashCommand(cmdName)
            slashResult = res.success ? `[SYSTEM: Source Code for "/${cmdName}" (${res.enabled ? 'active' : 'disabled'}):\n\`\`\`javascript\n${res.content}\n\`\`\`]` : `[SYSTEM: Failed to inspect "/${cmdName}": ${res.error}]`
          }

          channelHistory.messages.push({ role: 'system', content: slashResult })

          // If more commands in buffer, continue; otherwise follow up with LLM
          if (replyContent.match(COMMAND_REGEX)) {
            logger.info('AUTONOMOUS: More commands detected after slash command management, skipping intermediate followup.')
            continue
          }

          const followup = await this.queryOllamaWithContext([...channelHistory.messages], { ...ollamaContext, isCodeTask: true }, this.botName)
          replyContent = (replyContent + '\n' + (followup.message.content || '')).trim()
          channelHistory.messages.push(followup.message)
          continue
        }

        // Special case: Dynamic internal action synthesis (create_action, modify_action, delete_action)
        if (['create_action', 'modify_action', 'delete_action'].includes(rawCmdName)) {
          const actionName = (cmdData.name || params.name || '').trim().toLowerCase()
          const description = cmdData.description || params.description || ''
          const schema = cmdData.schema || params.schema || {}
          const code = cmdData.code || params.code || ''

          let synthesisResult = ''
          if (rawCmdName === 'create_action') {
            const reg = this.ActionExecutor.registerAction(actionName, description, schema, code)
            if (reg.success) {
              synthesisResult = `[SYSTEM: Successfully created and registered internal action "${actionName}". Description: "${description}". You may now execute <<<RUN_COMMAND: {"command": "${actionName}", ...}>>> immediately if needed.]`
            } else {
              synthesisResult = `[SYSTEM: Failed to create action "${actionName}": ${reg.error}]`
            }
          } else if (rawCmdName === 'modify_action') {
            const mod = this.ActionExecutor.modifyAction(actionName, { description, schema, code })
            if (mod.success) {
              synthesisResult = `[SYSTEM: Successfully modified dynamic action "${actionName}".]`
            } else {
              synthesisResult = `[SYSTEM: Failed to modify action "${actionName}": ${mod.error}]`
            }
          } else if (rawCmdName === 'delete_action') {
            const isOwner = interaction.user?.id === process.env.OWNER_ID
            const isDM = !interaction.guildId
            if (!isOwner && !isDM) {
              synthesisResult = '[SYSTEM: Error - Deleting custom actions is restricted to the bot creator.]'
            } else {
              const del = this.ActionExecutor.deleteAction(actionName)
              if (del.success) {
                synthesisResult = `[SYSTEM: Successfully deleted custom action "${actionName}".]`
              } else {
                synthesisResult = `[SYSTEM: Failed to delete action "${actionName}": ${del.error}]`
              }
            }
          }

          channelHistory.messages.push({ role: 'system', content: synthesisResult })

          // If more commands in buffer, continue; otherwise follow up with LLM
          if (replyContent.match(COMMAND_REGEX)) {
            logger.info('AUTONOMOUS: More commands detected after dynamic action synthesis, skipping intermediate followup.')
            continue
          }

          const followup = await this.queryOllamaWithContext([...channelHistory.messages], { ...ollamaContext, isCodeTask: true }, this.botName)
          replyContent = (replyContent + '\n' + (followup.message.content || '')).trim()
          channelHistory.messages.push(followup.message)
          continue
        }

        // Special case: natural language "memories" handled locally
        if (['remember', 'recall', 'forget'].includes(rawCmdName)) {
          const isOwner = interaction.user?.id === process.env.OWNER_ID
          const isDM = !interaction.guildId
          const targetGuildId = cmdData.guildId || cmdData.params?.guildId || (isOwner && isDM ? null : interaction.guildId)

          if (rawCmdName === 'remember') {
            const key = cmdData.key || cmdData.params?.key
            const value = cmdData.value || cmdData.params?.value
            const ttl = parseInt(cmdData.ttl_days ?? cmdData.params?.ttl_days ?? 30)
            if (key && value !== undefined) {
              this.agentMemory.set(key, value, ttl, targetGuildId)
              channelHistory.messages.push({ role: 'system', content: `[SYSTEM: Stored memory "${key}"]. Acknowledge naturally.]` })
            }
          } else if (rawCmdName === 'recall') {
            const key = cmdData.key || cmdData.params?.key
            const val = key ? this.agentMemory.get(key, targetGuildId) : null
            channelHistory.messages.push({ role: 'system', content: val ? `[SYSTEM: Memory found: "${val}"]` : `[SYSTEM: No memory found for "${key}"]` })
          } else if (rawCmdName === 'forget') {
            const key = cmdData.key || cmdData.params?.key
            if (key) {
              const success = this.agentMemory.delete(key)
              channelHistory.messages.push({ role: 'system', content: success ? `[SYSTEM: Forgotten memory "${key}"]` : `[SYSTEM: No memory found for "${key}"]` })
            }
          }

          channelHistory.messages.push({ role: 'system', content: '[SYSTEM: Operations complete. The user has been notified. Provide a 1-sentence final acknowledgement, then stop.]' })

          // BATCH DRAIN: If more tags are pending, don't query back yet
          if (replyContent.match(COMMAND_REGEX)) {
            logger.info('AUTONOMOUS: More commands detected after memory action, skipping intermediate followup.')
            continue
          }

          const followup = await this.queryOllamaWithContext([...channelHistory.messages], ollamaContext, this.botName)
          replyContent = (replyContent + '\n' + (followup.message.content || '')).trim()
          channelHistory.messages.push(followup.message)
          continue
        }

        const targetCmd = interaction.client.commands.get(rawCmdName)

        if (isAction || targetCmd) {
          if (!sharedState.primaryResponseUsed) {
            await interaction.editReply({ content: `*${this.botName} is autonomously executing \`${rawCmdName}\`...*`, flags: [MessageFlags.SuppressEmbeds] })
          }

          let actionResult = ''
          const targetChannel = interaction.channel
          const mock = createMockInteraction(interaction, {
            params: params || {},
            channel: targetChannel
          }, null, sharedState)

          if (isAction) {
            const actionContext = {
              interaction: mock, // Use the MOCK to capture state
              channel: targetChannel,
              client: interaction.client,
              guild: interaction.guild,
              userId: interaction.user.id,
              guildId: interaction.guildId,
              channelId: targetChannel.id,
              member: interaction.member,
              user: interaction.user
            }
            const result = await this.ActionExecutor.executeAction(rawCmdName, params, actionContext)
            if (result.success) sharedState.primaryResponseUsed = true
            const outputStr = typeof result.output === 'string' ? result.output : JSON.stringify(result.output)
            actionResult = result.success ? (outputStr || '[SYSTEM: Action executed successfully.]') : `[SYSTEM: Action failed: ${result.error}]`
          } else {
            mock.options = {
              getString: (n) => String(params[n] ?? this.getParam(cmdData, n) ?? ''),
              getSubcommand: () => params.subcommand || this.getParam(cmdData, 'subcommand'),
              getChannel: (n) => interaction.client.channels.cache.get((params[n] || this.getParam(cmdData, n) || '').toString().replace(/[<#>]/g, '')) || null,
              getBoolean: (n) => {
                const val = params[n] ?? this.getParam(cmdData, n)
                return val === true || val === 'true' || val === 1 || val === '1'
              },
              getInteger: (n) => parseInt(params[n] ?? this.getParam(cmdData, n) ?? 0),
              getUser: (n) => interaction.client.users.cache.get((params[n] || this.getParam(cmdData, n) || '').toString().replace(/[<@!>]/g, '')) || null,
              getAttachment: () => null,
              getMember: () => null
            }

            try {
              sharedState.primaryResponseUsed = true
              const output = await targetCmd.execute(mock, database)
              actionResult = typeof output === 'string' ? output : `[SYSTEM: Command /${rawCmdName} completed.]`
            } catch (err) {
              actionResult = `[SYSTEM: Error executing /${rawCmdName}: ${err.message}]`
            }
          }

          channelHistory.messages.push({ role: 'system', content: `[SYSTEM: Action Result: ${actionResult}. The result is visible to the user. Do NOT repeat the command. Provide a 1-sentence acknowledgement, then stop.]` })

          // BATCH DRAIN: If there are still more commands to run in the CURRENT replyContent,
          // we do NOT query back yet. We just continue the loop to process them.
          // This prevents the AI from "restating" the command in a followup and causing duplicates.
          if (replyContent.match(COMMAND_REGEX)) {
            logger.info('AUTONOMOUS: More commands detected in current buffer, skipping intermediate followup.')
            continue
          }

          const followup = await this.queryOllamaWithContext([...channelHistory.messages], ollamaContext, this.botName)
          replyContent = (replyContent + '\n' + (followup.message.content || '')).trim()
          channelHistory.messages.push(followup.message)
          continue
        }
      } catch (err) {
        // Malformed / partially valid JSON (or unexpected runtime errors) shouldn't
        // wedge the entire turn. Log and continue to allow the model to still reply.
        logger.warn(`AUTONOMOUS: Loop error (skipping command tag): ${err.message}`)
        continue
      }
    }

    return replyContent
  }
}

module.exports = AutonomousCommandProcessor
