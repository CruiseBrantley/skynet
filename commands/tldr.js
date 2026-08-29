const { SlashCommandBuilder, EmbedBuilder } = require('discord.js')
const { queryOllamaWithContext, getActiveModelCapabilities } = require('../util/ollama')
const { formatForEmbed } = require('../util/discordFormatter')
const logger = require('../logger')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tldr')
    .setDescription('Generate a structured summary digest of recent channel discussion')
    .addIntegerOption(option =>
      option
        .setName('count')
        .setDescription('Number of recent messages to analyze (default: auto based on active AI tier)')
        .setRequired(false)
        .setMinValue(5)
        .setMaxValue(100)
    )
    .addBooleanOption(option =>
      option
        .setName('all_days')
        .setDescription('Include messages from previous days (default: false, current day only)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('topic')
        .setDescription('Optional topic filter (e.g. "gaming", "server maintenance")')
        .setRequired(false)
    ),

  async execute (interaction) {
    await interaction.deferReply()
    const guildId = interaction.guildId

    try {
      const caps = await getActiveModelCapabilities()
      const requestedCount = interaction.options.getInteger('count')
      const topicFilter = interaction.options.getString('topic')
      const allDays = interaction.options.getBoolean('all_days') || false

      // Adaptively cap fetch count based on active model tier
      const maxAllowed = caps.maxDigestMessages || 25
      const fetchCount = requestedCount ? Math.min(requestedCount, maxAllowed) : Math.min(50, maxAllowed)

      logger.info(`tldr: Fetching ${fetchCount} messages for #${interaction.channel.name} (Tier: ${caps.tier}, allDays: ${allDays})`)
      const fetched = await interaction.channel.messages.fetch({ limit: fetchCount })
      let rawMessages = Array.from(fetched.values()).reverse()

      // Default: limit to messages sent during the current day unless all_days is explicitly true
      if (!allDays) {
        const startOfDay = new Date().setHours(0, 0, 0, 0)
        rawMessages = rawMessages.filter(m => (m.createdTimestamp || m.createdAt?.getTime?.() || 0) >= startOfDay)
      }

      const formattedChat = rawMessages
        .filter(m => !m.author.bot || m.author.id === interaction.client.user.id)
        .map(m => `[${new Date(m.createdTimestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}] @${m.author.username}: ${m.content}`)
        .join('\n')

      if (!formattedChat.trim()) {
        const emptyMsg = allDays
          ? 'No recent messages found to summarize.'
          : 'No messages found from today in this channel to summarize. Use `/tldr all_days:true` to include prior days.'
        return interaction.editReply({ content: emptyMsg })
      }

      const promptTopic = topicFilter ? ` Focus specifically on discussions related to: "${topicFilter}".` : ''
      const prompt = `Analyze the following channel discussion log from #${interaction.channel.name}.${promptTopic}\n\n` +
        'Provide a concise summary structured into:\n' +
        '1. Key Topics & Discussion Highlights\n' +
        '2. Decisions & Action Items (if any)\n' +
        '3. Notable Links or Media Mentioned (if any)\n\n' +
        'CRITICAL DISCORD FORMATTING INSTRUCTIONS:\n' +
        '- Keep total length under 2500 characters.\n' +
        '- Use bullet lists (- **Topic**: Details) instead of ASCII/Markdown tables.\n' +
        '- Use ### or bold text for section titles (NEVER use large # titles).\n\n' +
        `Channel History (${rawMessages.length} messages):\n\`\`\`\n${formattedChat}\n\`\`\``

      const messages = [
        { role: 'system', content: 'You are Skynet Channel Analyst. Produce structured, helpful summaries strictly formatted for Discord without fluff.' },
        { role: 'user', content: prompt }
      ]

      const result = await queryOllamaWithContext(messages, {
        guildId,
        userId: interaction.user.id
      })

      const rawSummaryText = result?.message?.content?.trim() || 'Failed to generate channel summary.'
      const cleanSummary = formatForEmbed(rawSummaryText, 4000)

      const tierBadge = caps.tier === 'remote_5090'
        ? `Qwen 3.8 27B (${rawMessages.length} msgs analyzed)`
        : `Gemma 4 Local (${rawMessages.length} msgs analyzed)`

      const embed = new EmbedBuilder()
        .setTitle(`📜 Channel Digest: #${interaction.channel.name}`)
        .setColor(0x00ae86)
        .setDescription(cleanSummary)
        .setFooter({ text: `Engine: ${tierBadge}` })
        .setTimestamp()

      return interaction.editReply({ embeds: [embed] })
    } catch (err) {
      logger.error(`tldr error: ${err.message}`)
      return interaction.editReply({ content: `An error occurred while generating digest: ${err.message}` })
    }
  }
}
