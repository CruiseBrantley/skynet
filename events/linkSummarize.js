const { MessageFlags } = require('discord.js')
const logger = require('../logger')
const { extractUrls, shouldSkipUrl, summarizeUrl, splitMessage } = require('../util/summarize')

const firebase = require('../firebase-login')
const processedMessages = new Set()
const summarizedUrls = new Map()
const lastSummaryTimeByChannel = new Map()
const CACHE_SIZE = 100
const URL_DEDUP_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const CHANNEL_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes

function linkSummarize (bot) {
  bot.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return

    // Skip messages sent more than 5 minutes ago
    if (Date.now() - message.createdAt.getTime() > 5 * 60 * 1000) return

    // Skip if channel is a Discord thread to avoid polluting focused discussion threads
    if (typeof message.channel?.isThread === 'function' && message.channel.isThread()) return

    // Deduplication Check by message ID
    if (message.id) {
      if (processedMessages.has(message.id)) return
      processedMessages.add(message.id)
      if (processedMessages.size > CACHE_SIZE) {
        const first = processedMessages.values().next().value
        processedMessages.delete(first)
      }
    }

    const urls = extractUrls(message.content)
    if (urls.length === 0) return

    const url = urls[0]
    if (shouldSkipUrl(url)) return

    const channelId = message.channel?.id || message.channelId
    const urlKey = `${channelId}:${url}`

    // Deduplication by URL per channel (prevent re-summarizing the same link)
    const lastUrlTime = summarizedUrls.get(urlKey) || 0
    if (Date.now() - lastUrlTime < URL_DEDUP_TTL_MS) return

    // Rate limit automatic link summaries per channel
    const lastChannelTime = lastSummaryTimeByChannel.get(channelId) || 0
    if (Date.now() - lastChannelTime < CHANNEL_COOLDOWN_MS) return

    // Fetch guild-level settings
    const database = firebase()
    const snapshot = await database.ref(`guild_settings/${message.guildId}`).once('value')
    const val = snapshot.val()
    const settings = (val && typeof val === 'object') ? val : { agent_enabled: val === true }
    const textEnabled = settings.proactive_text_enabled ?? settings.agent_enabled ?? false
    if (!textEnabled) return

    // If the bot is mentioned, let the chat command handle the link instead of the auto-summarizer
    if (message.mentions.has(bot.user)) return

    // Selective Check: Ask local LLM if this link is worth an automatic summary
    const { queryLocalOrRemote } = require('../util/ollama')
    const botName = process.env.BOT_NAME || 'Skynet'
    const decision = await queryLocalOrRemote('/api/chat', {
      messages: [
        { role: 'system', content: `You are ${botName}. Decide if this link should be automatically summarized for the channel. Respond only with YES or NO.\nLogic: Respond YES if the link looks like a complex article, news, or technical page where a summary adds value. Respond NO if it's a simple social media post, a common site, or clear from the title.` },
        { role: 'user', content: `Message: "${message.content}"\nURL: ${url}\n\nShould I summarize this?` }
      ],
      options: { temperature: 0, num_predict: 5 }
    }).catch(() => ({ message: { content: 'NO' } }))

    if (!decision?.message?.content?.toUpperCase().includes('YES')) return

    logger.info(`Link summary triggered (via AI decision) for: ${url}`)

    try {
      message.channel.sendTyping()

      const summary = await summarizeUrl(url, false)
      if (summary) {
        summarizedUrls.set(urlKey, Date.now())
        lastSummaryTimeByChannel.set(channelId, Date.now())

        const summarizeCmd = require('../commands/summarize')
        const id = summarizeCmd._cacheUrl(url)
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`summarize_expand_${id}`)
            .setLabel('Expand')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📖')
        )

        const chunks = splitMessage(`📰 **Summary:**\n${summary}`)
        for (let i = 0; i < chunks.length; i++) {
          const payload = {
            content: chunks[i],
            allowedMentions: { repliedUser: false },
            flags: [MessageFlags.SuppressEmbeds]
          }
          if (i === 0) payload.components = [row]

          if (i === 0) {
            await message.reply(payload)
          } else {
            await message.channel.send(payload)
          }
        }
      }
    } catch (err) {
      logger.error(`Link summary error: ${err.message}`)
    }
  })
}

linkSummarize._resetCache = () => {
  processedMessages.clear()
  summarizedUrls.clear()
  lastSummaryTimeByChannel.clear()
}

module.exports = linkSummarize
