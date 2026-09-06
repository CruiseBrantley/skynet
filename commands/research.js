const { SlashCommandBuilder, EmbedBuilder } = require('discord.js')
const { queryOllamaWithContext, getActiveModelCapabilities } = require('../util/ollama')
const { formatForEmbed } = require('../util/discordFormatter')
const { createStatusHeartbeat } = require('../util/chat/statusHeartbeat')
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
    await interaction.deferReply()
    const query = interaction.options.getString('query')
    const guildId = interaction.guildId
    const botName = interaction.client?.user?.username || 'Skynet'

    const heartbeat = createStatusHeartbeat(interaction, `${botName} is searching the web...`)
    await heartbeat.start()

    try {
      const caps = await getActiveModelCapabilities()
      logger.info(`research: Initiating search for query "${query}" (Tier: ${caps.tier})`)

      // Execute web search action
      let searchResults = ''
      try {
        const searchResult = await ActionExecutor.executeAction('web_search', { query }, interaction)
        if (searchResult && (searchResult.output || searchResult.result)) {
          const raw = searchResult.output || searchResult.result
          searchResults = typeof raw === 'string'
            ? raw
            : JSON.stringify(raw, null, 2)
        }
      } catch (searchErr) {
        logger.warn(`research: Web search action failed: ${searchErr.message}`)
        searchResults = 'No live web search results available; relying on model knowledge.'
      }

      await heartbeat.updateStatus(`${botName} is synthesizing research report...`)

      const prompt = `Conduct a technical research summary for the query: "${query}".\n\n` +
        `Web Search Findings:\n\`\`\`\n${searchResults.substring(0, 4000)}\n\`\`\`\n\n` +
        'Provide a clean, structured research report with:\n' +
        '1. Executive Summary & Overview\n' +
        '2. Technical Details & Key Specifications\n' +
        '3. Pros / Cons / Recommendations\n' +
        '4. Key Sources / References\n\n' +
        'CRITICAL DISCORD FORMATTING INSTRUCTIONS:\n' +
        '- Keep total length under 3000 characters.\n' +
        '- Use bullet lists (- **Item**: Details) instead of ASCII/Markdown tables.\n' +
        '- Use ### or bold text for section titles (NEVER use large # titles).'

      const messages = [
        { role: 'system', content: 'You are Skynet Autonomous Research Specialist. Provide objective, well-structured research reports formatted strictly for Discord.' },
        { role: 'user', content: prompt }
      ]

      const result = await queryOllamaWithContext(messages, {
        guildId,
        userId: interaction.user.id
      })

      const rawReportText = result?.message?.content?.trim() || 'Failed to generate research report.'
      const cleanReport = formatForEmbed(rawReportText, 4000)

      const tierBadge = caps.tier === 'remote_5090' ? 'Qwen 3.8 27B (Deep Search)' : 'Gemma 4 Local (Quick Pass)'

      const embed = new EmbedBuilder()
        .setTitle(`🔍 Research Report: ${query.length > 50 ? query.substring(0, 50) + '...' : query}`)
        .setColor(0x3498db)
        .setDescription(cleanReport)
        .setFooter({ text: `Engine: ${tierBadge}` })
        .setTimestamp()

      heartbeat.stop()
      return interaction.editReply({ content: '', embeds: [embed] })
    } catch (err) {
      heartbeat.stop()
      logger.error(`research error: ${err.message}`)
      return interaction.editReply({ content: `An error occurred while conducting research: ${err.message}`, embeds: [] })
    } finally {
      heartbeat.stop()
    }
  }
}
