const logger = require('../../logger')
const { jsonrepair } = require('jsonrepair')
const ollama = require('../ollama')

class SelfHealingEngine {
  constructor ({ actionExecutor, agentMemory } = {}) {
    this.actionExecutor = actionExecutor || require('../ActionExecutor')
    this.agentMemory = agentMemory || require('../AgentMemory')
  }

  /**
   * Attempt to self-heal a failing dynamic action using high-capability models (Remote 5090 or Gemini).
   * @param {object} options
   * @param {string} options.actionName
   * @param {string} options.description
   * @param {object} options.schema
   * @param {string} options.code
   * @param {Error|string} options.error
   * @param {object} options.params
   * @returns {Promise<{ success: boolean, fixedCode?: string, reasoning?: string, error?: string }>}
   */
  async healAction ({ actionName, description, schema, code, error, params = {} }) {
    logger.info(`SelfHealingEngine: Initiating self-healing reflection for action "${actionName}"...`)

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

      // Register the patched action via ActionExecutor
      const regResult = this.actionExecutor.registerAction(actionName, description || actionName, schema || {}, fixedCode)
      if (!regResult.success) {
        logger.warn(`SelfHealingEngine: Patched code failed registration validation: ${regResult.error}`)
        return { success: false, error: regResult.error }
      }

      // Store in memory for future reference
      try {
        this.agentMemory.set(`self_improvement.fixes.${actionName}`, {
          error: errorMessage,
          reasoning,
          fixedAt: new Date().toISOString()
        }, 30)
      } catch (memErr) {
        logger.warn(`SelfHealingEngine: Could not save fix to AgentMemory: ${memErr.message}`)
      }

      logger.info(`SelfHealingEngine: Successfully healed action "${actionName}". Reasoning: "${reasoning}"`)
      return { success: true, fixedCode, reasoning }
    } catch (err) {
      logger.error(`SelfHealingEngine: Failed to heal action "${actionName}": ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  /**
   * Attempt to self-heal a failing Discord slash command using high-capability models (Remote 5090 or Gemini).
   * @param {object} options
   * @param {string} options.commandName
   * @param {Error|string} options.error
   * @param {import('discord.js').CommandInteraction} [options.interaction]
   * @returns {Promise<{ success: boolean, fixedCode?: string, reasoning?: string, error?: string }>}
   */
  async healSlashCommand ({ commandName, error, interaction }) {
    const commandManager = require('../commandManager')
    const inspectRes = commandManager.inspectSlashCommand(commandName)
    if (!inspectRes.success || !inspectRes.content) {
      return { success: false, error: `Could not load source code for command "/${commandName}"` }
    }

    if (commandManager.PROTECTED_COMMANDS.has(commandName)) {
      return { success: false, error: `Command "/${commandName}" is protected from auto-mutation.` }
    }

    logger.info(`SelfHealingEngine: Initiating self-healing reflection for slash command "/${commandName}"...`)

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
3. If performing async network requests, ALWAYS use 'await interaction.deferReply()' first and 'await interaction.editReply(...)'.
4. For real-time web search, you may use 'const { searchViaGoogleGrounding } = require("../util/actions/web_search")' or axios/fetch with process.env.GEMINI_API_KEY.
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

      const saveRes = await commandManager.createSlashCommand({
        name: commandName,
        code: fixedCode,
        bot: interaction?.client,
        guildId: interaction?.guildId,
        isGlobal: !interaction?.guildId
      })

      if (!saveRes.success) {
        logger.warn(`SelfHealingEngine: Patched slash command failed validation: ${saveRes.error}`)
        return { success: false, error: saveRes.error }
      }

      try {
        this.agentMemory.set(`self_improvement.fixes.slash_${commandName}`, {
          error: errorMessage,
          reasoning,
          fixedAt: new Date().toISOString()
        }, 30)
      } catch (_) {}

      // Notify the channel where the error happened that the command was auto-healed
      if (interaction?.channel?.send) {
        interaction.channel.send(`🔧 **Auto-Repair**: Command \`/${commandName}\` encountered an error and was automatically patched by Skynet: *${reasoning}*. The updated command is now live on Discord!`).catch(() => {})
      }

      logger.info(`SelfHealingEngine: Successfully healed slash command "/${commandName}". Reasoning: "${reasoning}"`)
      return { success: true, fixedCode, reasoning }
    } catch (err) {
      logger.error(`SelfHealingEngine: Failed to heal slash command "/${commandName}": ${err.message}`)
      return { success: false, error: err.message }
    }
  }
}

module.exports = new SelfHealingEngine()
