const { SlashCommandBuilder, EmbedBuilder } = require('discord.js')
const { queryOllamaWithContext, getActiveModelCapabilities } = require('../util/ollama')
const { isFeatureEnabled } = require('../util/config_manager')
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
    .addStringOption(option =>
      option
        .setName('topic')
        .setDescription('Optional topic filter (e.g. "gaming", "server maintenance")')
        .setRequired(false)
    ),

  async execute (interaction) {
    const guildId = interaction.guildId
    if (!isFeatureEnabled('tldr', guildId)) {
      return interaction.reply({
        content: '❌ The `/tldr` channel digest feature is currently disabled on this server. Server admins can enable it using `/skynet-config toggle feature:tldr enabled:true`.',
        ephemeral: true
      })
    }

    await interaction.deferReply()

    try {
      const caps = await getActiveModelCapabilities()
      const requestedCount = interaction.options.getInteger('count')
      const topicFilter = interaction.options.getString('topic')

      // Adaptively cap fetch count based on active model tier
      const maxAllowed = caps.maxDigestMessages || 25
      const fetchCount = requestedCount ? Math.min(requestedCount, maxAllowed) : Math.min(50, maxAllowed)

      logger.info(`tldr: Fetching ${fetchCount} messages for #${interaction.channel.name} (Tier: ${caps.tier})`)
      const fetched = await interaction.channel.messages.fetch({ limit: fetchCount })
      const rawMessages = Array.from(fetched.values()).reverse()

      const formattedChat = rawMessages
        .filter(m => !m.author.bot || m.author.id === interaction.client.user.id)
        .map(m => `[${new Date(m.createdTimestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}] @${m.author.username}: ${m.content}`)
        .join('\n')

      if (!formattedChat.trim()) {
        return interaction.editReply({ content: 'No recent messages found to summarize.' })
      }

      const promptTopic = topicFilter ? ` Focus specifically on discussions related to: "${topicFilter}".` : ''
      const prompt = `Analyze the following channel discussion log from #${interaction.channel.name}.${promptTopic}\n\n` +
        'Provide a concise summary structured into:\n' +
        '1. Key Topics & Discussion Highlights\n' +
        '2. Decisions & Action Items (if any)\n' +
        '3. Notable Links or Media Mentioned (if any)\n\n' +
        `Channel History (${rawMessages.length} messages):\n\`\`\`\n${formattedChat}\n\`\`\``

      const messages = [
        { role: 'system', content: 'You are Skynet Channel Analyst. Produce structured, helpful summaries without fluff.' },
        { role: 'user', content: prompt }
      ]

      const result = await queryOllamaWithContext(messages, {
        guildId,
        userId: interaction.user.id
      })

      const summaryText = result?.message?.content?.trim() || 'Failed to generate channel summary.'

      const tierBadge = caps.tier === 'remote_5090'
        ? `Qwen 3.8 27B (${rawMessages.length} msgs analyzed)`
        : `Gemma 4 Local (${rawMessages.length} msgs analyzed)`

      const embed = new EmbedBuilder()
        .setTitle(`📜 Channel Digest: #${interaction.channel.name}`)
        .setColor(0x00ae86)
        .setDescription(summaryText.length > 4000 ? summaryText.substring(0, 4000) + '\n...(truncated)' : summaryText)
        .setFooter({ text: `Engine: ${tierBadge}` })
        .setTimestamp()

      return interaction.editReply({ embeds: [embed] })
    } catch (err) {
      logger.error(`tldr error: ${err.message}`)
      return interaction.editReply({ content: `An error occurred while generating digest: ${err.message}` })
    }
  }
}
