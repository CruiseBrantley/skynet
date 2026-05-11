const { SlashCommandBuilder, MessageFlags } = require('discord.js')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const botName = process.env.BOT_NAME || 'Bot'
const { queryOllamaWithContext } = require('../util/ollama')
const logger = require('../logger')
const agentMemory = require('../util/AgentMemory')
const ActionExecutor = require('../util/ActionExecutor')

const { COMMAND_REGEX, SCRUB_REGEX } = require('../util/chat/constants')
const { scrubTags } = require('../util/chat/scrubTags')
const { fetchAndFormatContext } = require('../util/chat/contextHelper')
const AutonomousCommandProcessor = require('../util/chat/AutonomousCommandProcessor')
const DiscordResponder = require('../util/chat/DiscordResponder')
const mentionResolver = require('../util/MentionResolver')
const { getParam } = require('../util/commandHelper')

const { getBasePrompt } = require('../util/systemPrompt')

const channelHistories = {}
const channelQueues = new Map() // Per-channel promise chains for sequential processing
const MAX_CHANNEL_HISTORIES = 50

module.exports = {
  data: new SlashCommandBuilder()
    .setName('chat')
    .setDescription(`Chat with ${botName}`)
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Message to send')
        .setRequired(true))
    .addAttachmentOption(option =>
      option.setName('image')
        .setDescription('Optional image to analyze (Vision models only)')
        .setRequired(false)),
  execute,
  scrubTags,
  COMMAND_REGEX,
  SCRUB_REGEX
}

async function execute (interaction, database) {
  const channelId = interaction.channelId

  // Always defer immediately to keep the interaction alive while waiting in queue
  await interaction.deferReply()

  // Get the current queue promise or start a new one
  const previousTurn = channelQueues.get(channelId) || Promise.resolve()

  // Chain the new request
  const currentTurn = (async () => {
    await previousTurn.catch(() => {}) // Wait for previous turn, ignore its errors

    try {
      const sharedState = {
        primaryResponseUsed: false,
        primaryContent: null,
        highImpactCount: 0
      }

      logger.info(`Chat command execution started for user: ${interaction.user.username}`)
      const rawInput = interaction.options.getString('message')
      const messageText = rawInput.replace(new RegExp(`<@!?${interaction.client.user.id}>`, 'g'), '').trim()
      const attachment = interaction.options.getAttachment('image') || (interaction.options.attachments && interaction.options.attachments.size > 0 ? interaction.options.attachments.first() : null)

      let base64Image = null
      if (attachment && attachment.contentType && attachment.contentType.startsWith('image/')) {
        try {
          const imageResponse = await axios.get(attachment.url, { responseType: 'arraybuffer' })
          base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64')
        } catch (err) {
          logger.error(`Failed to download image: ${err.message}`)
        }
      }

      // reset the chat thread after 10 minutes
      if (!channelHistories[channelId] || (Date.now() - channelHistories[channelId].time > (60000 * 10))) {
        channelHistories[channelId] = {
          time: Date.now(),
          messages: [{ role: 'system', content: getBasePrompt() }]
        }

        // Populate initial context with last 50 messages for better situational awareness
        try {
          const history = interaction.recentMessages || await fetchAndFormatContext(interaction.channel, interaction.client.user.id, 50, interaction.triggeringMessageId || interaction.id)
          channelHistories[channelId].messages.push(...history)
          logger.info(`Populated ${history.length} historical messages for channel context.`)
        } catch (err) {
          logger.warn(`Failed to fetch historical context for channel ${channelId}: ${err.message}`)
        }
        // Prune oldest histories if we exceed the cap
        const historyKeys = Object.keys(channelHistories)
        if (historyKeys.length > MAX_CHANNEL_HISTORIES) {
          const oldest = historyKeys.sort((a, b) => channelHistories[a].time - channelHistories[b].time)[0]
          delete channelHistories[oldest]
        }
      }

      channelHistories[channelId].time = Date.now()

      const userHandle = `@${interaction.user.username}${interaction.member?.nickname ? ` (${interaction.member.nickname})` : ''}`
      const userMessage = { role: 'user', content: `${userHandle}: ${messageText}` }
      if (base64Image) {
        userMessage.images = [base64Image]
      }
      channelHistories[channelId].messages.push(userMessage)

      // Sliding Window Context Capping:
      // Reserve index 0 (System Prompt), then only keep the last 50 chat elements (25 back-and-forth pairs).
      if (channelHistories[channelId].messages.length > 51) {
        channelHistories[channelId].messages = [
          channelHistories[channelId].messages[0],
          ...channelHistories[channelId].messages.slice(-50)
        ]
      }

      // Inject dynamic system context
      let commandsContext = 'Available Commands & Actions:\n'
      if (interaction.client.commands) {
        commandsContext += interaction.client.commands.map(c => {
          let paramStr = ''
          if (c.data && c.data.options && c.data.options.length > 0) {
            const params = c.data.options.map(o => {
              if (o.type === 1 || o.type === 2) {
              // Subcommand or Subcommand Group
                return `subcommand: "${o.name}" [${o.description}]`
              }
              return `"${o.name}": [${o.description}]`
            }).join(', ')
            paramStr = ` (JSON Params: {${params}})`
          }
          return `- ${c.data.name}: ${c.data.description}${paramStr}`
        }).join('\n')
      } else {
        commandsContext += 'Unknown'
      }
      commandsContext += '\n' + ActionExecutor.listActions().map(a => `- ${a.name}: ${a.description} (JSON Params: ${JSON.stringify(a.schema)})`).join('\n')
      let logsContext = 'No recent logs available.'
      try {
        const logPath = path.join(__dirname, '../logs/combined.log')
        if (fs.existsSync(logPath)) {
        // Cap logs to the last 8 lines, and truncate each line to 200 chars to avoid massive token bloat from giant stack traces
          const logLines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(l => l.trim().length > 0).slice(-8).map(l => l.substring(0, 200))
          logsContext = 'Recent System Logs (Format: JSON):\n' + logLines.join('\n')
        }
      } catch (e) {
        logger.error('Failed to read logs for chatbot context: ' + e.message)
      }

      const currentIsBackup = false

      mentionResolver.record(interaction.user.username, interaction.user.id)
      if (interaction.member?.nickname) mentionResolver.record(interaction.member.nickname, interaction.user.id)

      // ---------------------------------------------
      // 🧊 Context Enrichment: Real-time Channel State
      // Fetch recent messages to see IDs and Reactions so actions like add_reaction or send_thread can target them
      let channelContext = 'Recent Channel Context:\n(No recent history available)'
      try {
        const recentMessages = await interaction.channel.messages.fetch({ limit: 50 })
        channelContext = 'Recent Channel Context:\n' + recentMessages.map(m => {
          mentionResolver.record(m.author.username, m.author.id)
          if (m.member?.nickname) mentionResolver.record(m.member.nickname, m.author.id)

          const reactions = m.reactions.cache.map(r => `${r.emoji.name} (x${r.count})`).join(', ')
          const authorHandle = `@${m.author.username}${m.member?.nickname ? ` (${m.member.nickname})` : ''}`

          // Resolve mentions in the text for the AI's convenience
          let enrichedContent = m.content
          const mentions = m.content.match(/<@!?(\d+)>/g)
          if (mentions) {
            for (const mention of mentions) {
              const id = mention.replace(/[<@!>]/g, '')
              const user = interaction.client.users.cache.get(id)
              if (user) {
                enrichedContent = enrichedContent.replaceAll(mention, `@${user.username}`)
                mentionResolver.record(user.username, id)
              }
            }
          }
          const elapsed = Date.now() - m.createdAt.getTime()
          const elapsedMinutes = Math.floor(elapsed / 60000)
          let timeLabel
          if (elapsedMinutes < 1) timeLabel = 'just now'
          else if (elapsedMinutes < 60) timeLabel = `${elapsedMinutes}m ago`
          else if (elapsedMinutes < 1440) timeLabel = `${Math.floor(elapsedMinutes / 60)}h ago`
          else timeLabel = `${Math.floor(elapsedMinutes / 1440)}d ago`

          return `ID: ${m.id} | Time: ${timeLabel} | Author: ${authorHandle} | Text: "${enrichedContent.substring(0, 100)}${enrichedContent.length > 100 ? '...' : ''}" ${reactions ? `| Reactions: [${reactions}]` : ''}`
        }).reverse().join('\n')
        logger.info(`Context Enrichment: Fetched ${recentMessages.size} messages for context.`)
      } catch (e) {
        logger.warn(`Context Enrichment: Failed to fetch channel context: ${e.message}`)
      }

      // We append this as a TEMPORARY system message for this specific prompt, but ensure it goes BEFORE the user's latest message
      const historyWithoutLast = channelHistories[channelId].messages.slice(0, -1)
      const lastUserMessage = channelHistories[channelId].messages[channelHistories[channelId].messages.length - 1]

      const finalPromptMessages = [
        ...historyWithoutLast,
        { role: 'system', content: channelContext },
        lastUserMessage
      ]

      logger.info(`Chat Context: Sending prompt with ${finalPromptMessages.length} messages. Commands: ${ActionExecutor.listActions().length} available.`)
      const ollamaContext = {
        isBackup: currentIsBackup,
        commandsContext,
        logsContext,
        guildId: interaction.guildId,
        systemPrompt: getBasePrompt()
      }
      const responseData = await queryOllamaWithContext(finalPromptMessages, ollamaContext, botName)
      if (responseData && responseData.message) {
        const rawAIContent = responseData.message.content || ''
        logger.info(`AI Raw Response: "${rawAIContent.substring(0, 300)}${rawAIContent.length > 300 ? '...' : ''}"`)
        channelHistories[channelId].messages.push(responseData.message) // store assistant reply

        // Discord message max length is 2000. Chunk intelligently.
        let replyContent = responseData.message.content || ''

        // Resolve @mentions back to <@ID> using the persistent resolver
        replyContent = mentionResolver.resolve(replyContent)

        const processor = new AutonomousCommandProcessor({
          botName,
          ActionExecutor,
          agentMemory,
          queryOllamaWithContext,
          getParam
        })
        replyContent = await processor.process({
          interaction,
          database,
          channelHistory: channelHistories[channelId],
          replyContent,
          sharedState,
          ollamaContext
        })

        const responder = new DiscordResponder({ botName })
        await responder.sendFinalResponse({ interaction, replyContent, sharedState })

        // Post-Turn Cleanup:
        // Erase any intermediate "system" messages (like the 18k HTML search payload) from the memory history
        // to prevent token runaway in future interactions. The AI's final answered message holds enough context.
        if (channelHistories[channelId]?.messages) {
          channelHistories[channelId].messages = channelHistories[channelId].messages.filter((msg, idx) => {
          // Keep the primary system prompt (idx 0) and any user/assistant messages.
            return idx === 0 || msg.role !== 'system'
          })
        }
      } else {
        throw new Error('Invalid response from Ollama')
      }
    } catch (err) {
      logger.error('Ollama error: ' + err.message)
      try {
        await interaction.editReply({ content: `There was an error communicating with the ${botName} AI Core.`, flags: [MessageFlags.SuppressEmbeds] })
      } catch (e) {
        await interaction.channel.send(`There was an error communicating with the ${botName} AI Core.`)
      }
    }
  })()

  channelQueues.set(channelId, currentTurn)
  return currentTurn
}
