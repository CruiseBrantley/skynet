const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')
const logger = require('../logger')
const { extractUrls, shouldSkipUrl, summarizeUrl, splitMessage } = require('../util/summarize')

// Cache to store URLs for button clicks (Discord customId limit is 100 chars)
const urlCache = new Map()

module.exports = {
  data: new SlashCommandBuilder()
    .setName('summarize')
    .setDescription('Summarize a web page article or story')
    .addStringOption(option =>
      option.setName('url')
        .setDescription('The URL to summarize')
        .setRequired(true))
    .addBooleanOption(option =>
      option.setName('long')
        .setDescription('Provide a more detailed summary')
        .setRequired(false)),

  async handleButton (interaction) {
    const parts = interaction.customId.split('_')
    const id = parts[2] // summarize_expand_[id]
    const url = urlCache.get(id)

    if (!url) {
      return interaction.reply({ content: 'This expansion link has expired. Please post the link again to see a summary.', ephemeral: true })
    }

    await interaction.deferReply({ ephemeral: true })
    try {
      const summary = await summarizeUrl(url, true) // Always long mode for expansion
      if (summary) {
        // Ensure we have a thread to post in
        let target = interaction.channel
        if (!interaction.message.thread) {
          target = await interaction.message.startThread({
            name: 'Detailed Summary',
            autoArchiveDuration: 60
          })
        } else {
          target = interaction.message.thread
        }

        const chunks = splitMessage(`📖 **Detailed Summary:**\n${summary}`)
        for (let i = 0; i < chunks.length; i++) {
          await target.send({ content: chunks[i], flags: [MessageFlags.SuppressEmbeds] })
        }

        await interaction.editReply({ content: 'Detailed summary has been posted in the thread below!' })
      } else {
        await interaction.editReply('Could not extract enough text for a detailed summary.')
      }
    } catch (err) {
      logger.error(`Expand button error: ${err.message}`)
      await interaction.editReply('There was an error expanding that summary.')
    }
  },

  async execute (interaction) {
    const input = interaction.options.getString('url')
    const isLong = interaction.options.getBoolean('long') || false
    const urls = extractUrls(input)

    if (urls.length === 0) {
      return interaction.reply({ content: 'No valid URL found. Please provide a link.', ephemeral: true })
    }

    const url = urls[0]
    if (shouldSkipUrl(url)) {
      return interaction.reply({ content: 'That link type cannot be summarized.', ephemeral: true })
    }

    await interaction.deferReply()

    try {
      const summary = await summarizeUrl(url, isLong)
      if (summary) {
        // Store in cache for 15 mins
        const id = Math.random().toString(36).substring(7)
        urlCache.set(id, url)
        setTimeout(() => urlCache.delete(id), 15 * 60 * 1000)

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`summarize_expand_${id}`)
            .setLabel('Expand to Detailed Summary')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📖')
        )

        const chunks = splitMessage(`📰 **Summary:**\n${summary}`)
        for (let i = 0; i < chunks.length; i++) {
          const payload = { content: chunks[i], flags: [MessageFlags.SuppressEmbeds] }
          if (i === 0 && !isLong) payload.components = [row]

          if (i === 0) {
            await interaction.editReply(payload)
          } else {
            await interaction.followUp(payload)
          }
        }
      } else {
        await interaction.editReply('Could not extract enough text to summarize.')
      }
    } catch (err) {
      logger.error(`Summarize command error: ${err.message}`)
      await interaction.editReply('There was an error summarizing that link.')
    }
  },

  // Helper exported for linkSummarize event
  _cacheUrl: (url) => {
    const id = Math.random().toString(36).substring(7)
    urlCache.set(id, url)
    setTimeout(() => urlCache.delete(id), 15 * 60 * 1000)
    return id
  }
}
