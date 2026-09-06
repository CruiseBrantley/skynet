const fs = require('fs')
const path = require('path')
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')
const logger = require('../../logger')
const { jsonrepair } = require('jsonrepair')
const ollama = require('../../util/ollama')

const DATA_DIR = path.join(__dirname, '../../data')
const PROPOSALS_FILE = path.join(DATA_DIR, 'pending_repairs.json')
const BACKUPS_DIR = path.join(DATA_DIR, 'command_backups')
const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

class SelfHealingEngine {
  constructor ({ actionExecutor, agentMemory } = {}) {
    this.actionExecutor = actionExecutor || require('../../util/ActionExecutor')
    this.agentMemory = agentMemory || require('../../util/AgentMemory')
    this.pendingProposals = new Map()
    this._loadProposals()
  }

  // ─── Persistence & Backups ──────────────────────────────────────────────────

  _loadProposals () {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
      }
      if (fs.existsSync(PROPOSALS_FILE)) {
        const raw = fs.readFileSync(PROPOSALS_FILE, 'utf8')
        const parsed = JSON.parse(raw)
        const now = Date.now()
        this.pendingProposals.clear()

        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.proposalId && item.timestamp && (now - item.timestamp) < PROPOSAL_TTL_MS) {
              this.pendingProposals.set(item.proposalId, item)
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`SelfHealingEngine: Could not load pending repairs file: ${err.message}`)
      this.pendingProposals.clear()
    }
  }

  _saveProposals () {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
      }
      const array = Array.from(this.pendingProposals.values())
      fs.writeFileSync(PROPOSALS_FILE, JSON.stringify(array, null, 2), 'utf8')
    } catch (err) {
      logger.warn(`SelfHealingEngine: Could not save pending repairs: ${err.message}`)
    }
  }

  _createBackup (targetType, name) {
    try {
      if (!fs.existsSync(BACKUPS_DIR)) {
        fs.mkdirSync(BACKUPS_DIR, { recursive: true })
      }

      let sourcePath = null
      if (targetType === 'slash') {
        sourcePath = path.join(__dirname, '../../commands', `${name}.js`)
      } else if (targetType === 'action') {
        sourcePath = path.join(__dirname, '../../data/agent_actions', `${name}.js`)
      }

      if (sourcePath && fs.existsSync(sourcePath)) {
        const backupId = `bak_${targetType}_${name}_${Date.now()}`
        const backupPath = path.join(BACKUPS_DIR, `${backupId}.bak.js`)
        fs.copyFileSync(sourcePath, backupPath)
        logger.info(`SelfHealingEngine: Created backup snapshot for ${targetType} "${name}" at ${backupId}`)
        return backupId
      }
    } catch (err) {
      logger.warn(`SelfHealingEngine: Could not create backup snapshot: ${err.message}`)
    }
    return null
  }

  _generateProposalId (name) {
    return `repair_${name.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`
  }

  // ─── Approval Cards ─────────────────────────────────────────────────────────

  async _sendApprovalCard ({ proposalId, targetName, targetType, error, reasoning, fixedCode, interaction, client }) {
    const ownerId = process.env.OWNER_ID
    const botClient = client || interaction?.client

    const embed = new EmbedBuilder()
      .setTitle(`🔧 Proposed Auto-Repair: ${targetType === 'slash' ? `/${targetName}` : targetName}`)
      .setColor(0xFFA500)
      .setDescription('A runtime error occurred and a code repair has been formulated by the reasoning model. Review the proposed fix below and approve or reject it.')
      .addFields(
        { name: '❌ Error Encountered', value: `\`\`\`${String(error).substring(0, 500)}\`\`\`` },
        { name: '💡 Diagnosis & Fix', value: reasoning.substring(0, 1000) },
        { name: '📄 Patch Preview', value: `\`\`\`javascript\n${fixedCode.substring(0, 600)}${fixedCode.length > 600 ? '\n... (truncated)' : ''}\n\`\`\`` }
      )
      .setFooter({ text: `Proposal ID: ${proposalId} • Owner Approval Required` })
      .setTimestamp()

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`repair_approve_${proposalId}`)
        .setLabel('Approve & Apply Fix')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`repair_reject_${proposalId}`)
        .setLabel('Reject Fix')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌')
    )

    let sent = false

    if (interaction && interaction.user?.id === ownerId && interaction.channel?.send) {
      try {
        await interaction.channel.send({ embeds: [embed], components: [row] })
        sent = true
      } catch (e) {
        logger.warn(`SelfHealingEngine: Could not send approval card to interaction channel: ${e.message}`)
      }
    }

    if (!sent && botClient && ownerId) {
      try {
        const owner = await botClient.users.fetch(ownerId).catch(() => null)
        if (owner) {
          await owner.send({ embeds: [embed], components: [row] })
          sent = true
        }
      } catch (e) {
        logger.warn(`SelfHealingEngine: Could not send approval card via DM to owner: ${e.message}`)
      }
    }

    return sent
  }

  // ─── Proposing Repairs ─────────────────────────────────────────────────────

  async proposeActionFix ({ actionName, description, schema, code, error, params = {}, interaction, client, autoApply = false }) {
    logger.info(`SelfHealingEngine: Formulating repair proposal for action "${actionName}"...`)

    const errorMessage = error?.message || String(error || 'Unknown runtime error')
    const stackTrace = error?.stack ? `\nStack Trace:\n${error.stack.split('\n').slice(0, 5).join('\n')}` : ''

    const prompt = `You are an expert Discord.js engineer and debugger. A dynamic Discord action named "${actionName}" threw a runtime error during execution.
Your objective is to inspect the error, identify the root cause, and output the corrected JavaScript function body.

[ACTION DETAILS]
Name: ${actionName}
Description: ${description || 'Custom dynamic action'}
Parameter Schema: ${JSON.stringify(schema || {}, null, 2)}

[INVOCATION PARAMETERS]
${JSON.stringify(params, null, 2)}

[CURRENT FAULTY CODE]
${code}

[RUNTIME ERROR]
${errorMessage}${stackTrace}

[CONSTRAINTS & RULES]
1. Function signature is always: async (bot, channel, params) => { ... }
2. You must provide ONLY the function body code that will be executed inside that wrapper.
3. Allowed APIs: Discord.js v14 (e.g. channel.send, channel.sendTyping, bot.users.fetch, EmbedBuilder).
4. Strictly FORBIDDEN: require('fs'), require('child_process'), require('os'), require('net'), require('http'), require('https'), process.env, eval, new Function.
5. If using Discord embeds or polls, ensure valid discord.js v14 objects.
6. Return ONLY a single valid JSON object. Do not output markdown fences or explanatory text outside the JSON.

Expected JSON Schema:
{
  "reasoning": "A concise explanation of the bug and the exact fix applied.",
  "fixed_code": "The complete replacement JavaScript function body."
}`

    try {
      const response = await ollama.queryCodeCapableModel('/api/chat', {
        messages: [
          { role: 'system', content: 'You are an autonomous code repair engine. Output ONLY valid JSON containing "reasoning" and "fixed_code".' },
          { role: 'user', content: prompt }
        ],
        options: { temperature: 0.1 }
      })

      const raw = response?.message?.content?.trim() || ''
      const firstBrace = raw.indexOf('{')
      const lastBrace = raw.lastIndexOf('}')

      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error('LLM response did not contain a valid JSON object.')
      }

      const parsed = JSON.parse(jsonrepair(raw.substring(firstBrace, lastBrace + 1)))
      const fixedCode = parsed.fixed_code || parsed.code || ''
      const reasoning = parsed.reasoning || 'Auto-corrected syntax or API usage error.'

      if (!fixedCode || typeof fixedCode !== 'string') {
        throw new Error('LLM did not provide a valid "fixed_code" string in response.')
      }

      const proposalId = this._generateProposalId(actionName)
      const proposal = {
        proposalId,
        targetType: 'action',
        name: actionName,
        description: description || actionName,
        schema: schema || {},
        fixedCode,
        reasoning,
        error: errorMessage,
        timestamp: Date.now()
      }

      this.pendingProposals.set(proposalId, proposal)
      this._saveProposals()

      if (autoApply) {
        return this.applyPendingRepair(proposalId, process.env.OWNER_ID, client || interaction?.client)
      }

      await this._sendApprovalCard({
        proposalId,
        targetName: actionName,
        targetType: 'action',
        error: errorMessage,
        reasoning,
        fixedCode,
        interaction,
        client
      })

      return { success: true, proposalId, reasoning, fixedCode }
    } catch (err) {
      logger.error(`SelfHealingEngine: Failed to propose action fix for "${actionName}": ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  async proposeSlashCommandFix ({ commandName, error, interaction, client, autoApply = false }) {
    const commandManager = require('../../util/commandManager')
    const inspectRes = commandManager.inspectSlashCommand(commandName)
    if (!inspectRes.success || !inspectRes.content) {
      return { success: false, error: `Could not load source code for command "/${commandName}"` }
    }

    if (commandManager.PROTECTED_COMMANDS.has(commandName)) {
      return { success: false, error: `Command "/${commandName}" is protected from auto-mutation.` }
    }

    logger.info(`SelfHealingEngine: Formulating repair proposal for slash command "/${commandName}"...`)

    const errorMessage = error?.message || String(error || 'Unknown runtime error')
    const stackTrace = error?.stack ? `\nStack Trace:\n${error.stack.split('\n').slice(0, 5).join('\n')}` : ''

    const prompt = `You are an expert Discord.js v14 engineer and debugger. The Discord slash command "/${commandName}" encountered a runtime error during execution.
Your objective is to inspect the error and existing code, identify the root cause, and output the complete corrected JavaScript file.

[COMMAND SOURCE CODE]
\`\`\`javascript
${inspectRes.content}
\`\`\`

[RUNTIME ERROR]
${errorMessage}${stackTrace}

[CONSTRAINTS & RULES]
1. Return the complete, valid JavaScript module for the slash command (including module.exports, data = new SlashCommandBuilder(), and execute: async (interaction) => { ... }).
2. Ensure proper Discord.js v14 API usage (e.g. interaction.reply, interaction.deferReply, interaction.editReply, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder).
4. For web search or research, you may use 'const ActionExecutor = require("../util/ActionExecutor"); const result = await ActionExecutor.executeAction("web_search", { query }, interaction);' or axios/fetch with public endpoints.
5. Strictly FORBIDDEN: require('fs'), require('child_process'), require('os'), require('net'), process.exit, eval.
6. Return ONLY a single valid JSON object. Do not output markdown fences or explanatory text outside the JSON.

Expected JSON Schema:
{
  "reasoning": "A concise explanation of the bug and the exact fix applied.",
  "fixed_code": "The complete replacement JavaScript file code."
}`

    try {
      const response = await ollama.queryCodeCapableModel('/api/chat', {
        messages: [
          { role: 'system', content: 'You are an autonomous Discord command repair engine. Output ONLY valid JSON containing "reasoning" and "fixed_code".' },
          { role: 'user', content: prompt }
        ],
        options: { temperature: 0.1 }
      })

      const raw = response?.message?.content?.trim() || ''
      const firstBrace = raw.indexOf('{')
      const lastBrace = raw.lastIndexOf('}')

      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error('LLM response did not contain a valid JSON object.')
      }

      const parsed = JSON.parse(jsonrepair(raw.substring(firstBrace, lastBrace + 1)))
      const fixedCode = parsed.fixed_code || parsed.code || ''
      const reasoning = parsed.reasoning || 'Auto-corrected slash command runtime error.'

      if (!fixedCode || typeof fixedCode !== 'string') {
        throw new Error('LLM did not provide a valid "fixed_code" string in response.')
      }

      const proposalId = this._generateProposalId(commandName)
      const proposal = {
        proposalId,
        targetType: 'slash',
        name: commandName,
        fixedCode,
        reasoning,
        error: errorMessage,
        guildId: interaction?.guildId,
        isGlobal: !interaction?.guildId,
        timestamp: Date.now()
      }

      this.pendingProposals.set(proposalId, proposal)
      this._saveProposals()

      if (autoApply) {
        return this.applyPendingRepair(proposalId, process.env.OWNER_ID, client || interaction?.client)
      }

      await this._sendApprovalCard({
        proposalId,
        targetName: commandName,
        targetType: 'slash',
        error: errorMessage,
        reasoning,
        fixedCode,
        interaction,
        client
      })

      return { success: true, proposalId, reasoning, fixedCode }
    } catch (err) {
      logger.error(`SelfHealingEngine: Failed to propose slash command fix for "/${commandName}": ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  // ─── Applying Approved Repairs ───────────────────────────────────────────────

  async applyPendingRepair (proposalId, approvingUserId, client) {
    const ownerId = process.env.OWNER_ID
    if (ownerId && approvingUserId !== ownerId) {
      logger.warn(`SelfHealingEngine: Unauthorized approval attempt by user ${approvingUserId}`)
      return { success: false, error: 'Unauthorized: Only the bot owner can approve code repairs.' }
    }

    const proposal = this.pendingProposals.get(proposalId)
    if (!proposal) {
      return { success: false, error: `Proposal "${proposalId}" not found or expired.` }
    }

    logger.info(`SelfHealingEngine: Applying owner-approved repair for ${proposal.targetType} "${proposal.name}"...`)

    // Snapshot existing file before applying fix
    const backupId = this._createBackup(proposal.targetType, proposal.name)

    if (proposal.targetType === 'slash') {
      const commandManager = require('../../util/commandManager')
      const saveRes = await commandManager.createSlashCommand({
        name: proposal.name,
        code: proposal.fixedCode,
        bot: client,
        guildId: proposal.guildId,
        isGlobal: proposal.isGlobal
      })

      if (!saveRes.success) {
        logger.warn(`SelfHealingEngine: Approved patch failed validation: ${saveRes.error}`)
        return { success: false, error: saveRes.error }
      }

      try {
        this.agentMemory.set(`self_improvement.fixes.slash_${proposal.name}`, {
          error: proposal.error,
          reasoning: proposal.reasoning,
          backupId,
          approvedBy: approvingUserId,
          fixedAt: new Date().toISOString()
        }, 30)
      } catch (_) {}

      this.pendingProposals.delete(proposalId)
      this._saveProposals()
      return { success: true, name: proposal.name, targetType: 'slash', reasoning: proposal.reasoning, fixedCode: proposal.fixedCode, backupId }
    }

    if (proposal.targetType === 'action') {
      const regResult = this.actionExecutor.registerAction(
        proposal.name,
        proposal.description,
        proposal.schema,
        proposal.fixedCode
      )

      if (!regResult.success) {
        logger.warn(`SelfHealingEngine: Approved action patch failed registration: ${regResult.error}`)
        return { success: false, error: regResult.error }
      }

      try {
        this.agentMemory.set(`self_improvement.fixes.${proposal.name}`, {
          error: proposal.error,
          reasoning: proposal.reasoning,
          backupId,
          approvedBy: approvingUserId,
          fixedAt: new Date().toISOString()
        }, 30)
      } catch (_) {}

      this.pendingProposals.delete(proposalId)
      this._saveProposals()
      return { success: true, name: proposal.name, targetType: 'action', reasoning: proposal.reasoning, fixedCode: proposal.fixedCode, backupId }
    }

    return { success: false, error: 'Unknown target type' }
  }

  async rejectPendingRepair (proposalId, rejectingUserId) {
    const ownerId = process.env.OWNER_ID
    if (ownerId && rejectingUserId !== ownerId) {
      return { success: false, error: 'Unauthorized: Only the bot owner can reject code repairs.' }
    }

    const proposal = this.pendingProposals.get(proposalId)
    if (!proposal) {
      return { success: false, error: `Proposal "${proposalId}" not found.` }
    }

    this.pendingProposals.delete(proposalId)
    this._saveProposals()
    logger.info(`SelfHealingEngine: Rejected repair proposal "${proposalId}" for ${proposal.name}`)
    return { success: true, name: proposal.name }
  }

  // ─── Rollback ───────────────────────────────────────────────────────────────

  async rollbackRepair (backupId, requestingUserId, client) {
    const ownerId = process.env.OWNER_ID
    if (ownerId && requestingUserId !== ownerId) {
      return { success: false, error: 'Unauthorized: Only the bot owner can roll back repairs.' }
    }

    if (!backupId || typeof backupId !== 'string') {
      return { success: false, error: 'Invalid backup identifier.' }
    }

    const backupFile = path.join(BACKUPS_DIR, `${backupId}.bak.js`)
    if (!fs.existsSync(backupFile)) {
      return { success: false, error: `Backup snapshot "${backupId}" was not found on disk.` }
    }

    try {
      const backupCode = fs.readFileSync(backupFile, 'utf8')
      const parts = backupId.replace(/^bak_/, '').split('_')
      const targetType = parts[0] // 'slash' | 'action'
      const name = parts.slice(1, -1).join('_')

      if (targetType === 'slash') {
        const commandManager = require('../../util/commandManager')
        const saveRes = await commandManager.createSlashCommand({
          name,
          code: backupCode,
          bot: client,
          isGlobal: true
        })
        if (!saveRes.success) return { success: false, error: saveRes.error }
      } else if (targetType === 'action') {
        const regRes = this.actionExecutor.registerAction(name, name, {}, backupCode)
        if (!regRes.success) return { success: false, error: regRes.error }
      } else {
        return { success: false, error: 'Unrecognized target type in backup metadata.' }
      }

      logger.info(`SelfHealingEngine: Successfully rolled back ${targetType} "${name}" from snapshot ${backupId}`)
      return { success: true, name, targetType }
    } catch (err) {
      logger.error(`SelfHealingEngine: Rollback failed for ${backupId}: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  getPendingProposals () {
    return Array.from(this.pendingProposals.values())
  }

  // ─── Aliases ────────────────────────────────────────────────────────────────

  async healAction (options) {
    return this.proposeActionFix({ ...options, autoApply: true })
  }

  async healSlashCommand (options) {
    return this.proposeSlashCommandFix({ ...options, autoApply: true })
  }
}

module.exports = new SelfHealingEngine()
