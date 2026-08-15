const { SlashCommandBuilder, EmbedBuilder } = require('discord.js')
const { queryOllamaWithContext, getActiveModelCapabilities } = require('../util/ollama')
const { isFeatureEnabled } = require('../util/config_manager')
const ActionExecutor = require('../util/ActionExecutor')
const logger = require('../logger')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('research')
    .setDescription('Perform an AI-powered web research report on any topic or technical query')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('The research topic, question, or technology to investigate')
        .setRequired(true)
    ),

  async execute (interaction) {
    const guildId = interaction.guildId
    if (!isFeatureEnabled('research', guildId)) {
      return interaction.reply({
        content: '❌ The `/research` feature is currently disabled on this server. Server admins can enable it using `/skynet-config toggle feature:research enabled:true`.',
        ephemeral: true
      })
    }

    await interaction.deferReply()
    const query = interaction.options.getString('query')

    try {
      const caps = await getActiveModelCapabilities()
      logger.info(`research: Initiating search for query "${query}" (Tier: ${caps.tier})`)

      // Execute web search action
      let searchResults = ''
      try {
        const searchResult = await ActionExecutor.execute('web_search', { query })
        if (searchResult && searchResult.result) {
          searchResults = typeof searchResult.result === 'string'
            ? searchResult.result
            : JSON.stringify(searchResult.result, null, 2)
        }
      } catch (searchErr) {
        logger.warn(`research: Web search action failed: ${searchErr.message}`)
        searchResults = 'No live web search results available; relying on model knowledge.'
      }

      const prompt = `Conduct a technical research summary for the query: "${query}".\n\n` +
        `Web Search Findings:\n\`\`\`\n${searchResults.substring(0, 4000)}\n\`\`\`\n\n` +
        'Provide a clean, structured research report with:\n' +
        '1. Executive Summary & Overview\n' +
        '2. Technical Details & Key Specifications\n' +
        '3. Pros / Cons / Recommendations\n' +
        '4. Key Sources / References'

      const messages = [
        { role: 'system', content: 'You are Skynet Autonomous Research Specialist. Provide objective, well-structured research reports.' },
        { role: 'user', content: prompt }
      ]

      const result = await queryOllamaWithContext(messages, {
        guildId,
        userId: interaction.user.id
      })

      const reportText = result?.message?.content?.trim() || 'Failed to generate research report.'
      const tierBadge = caps.tier === 'remote_5090' ? 'Qwen 3.8 27B (Deep Search)' : 'Gemma 4 Local (Quick Pass)'

      const embed = new EmbedBuilder()
        .setTitle(`🔍 Research Report: ${query.length > 50 ? query.substring(0, 50) + '...' : query}`)
        .setColor(0x3498db)
        .setDescription(reportText.length > 4000 ? reportText.substring(0, 4000) + '\n...(truncated)' : reportText)
        .setFooter({ text: `Engine: ${tierBadge}` })
        .setTimestamp()

      return interaction.editReply({ embeds: [embed] })
    } catch (err) {
      logger.error(`research error: ${err.message}`)
      return interaction.editReply({ content: `An error occurred while conducting research: ${err.message}` })
    }
  }
}
