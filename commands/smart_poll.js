const { SlashCommandBuilder } = require('discord.js')
const { queryOllamaWithContext, getActiveModelCapabilities } = require('../util/ollama')
const { isFeatureEnabled } = require('../util/config_manager')
const logger = require('../logger')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('smart-poll')
    .setDescription('Synthesize channel discussion or a topic into a native Discord Poll')
    .addStringOption(option =>
      option
        .setName('topic')
        .setDescription('Optional custom topic or question (default: auto-synthesize from recent channel discussion)')
        .setRequired(false)
    ),

  async execute (interaction) {
    const guildId = interaction.guildId
    if (!isFeatureEnabled('smart_poll', guildId)) {
      return interaction.reply({
        content: '❌ The `/smart-poll` feature is currently disabled on this server. Server admins can enable it using `/skynet-config toggle feature:smart_poll enabled:true`.',
        ephemeral: true
      })
    }

    await interaction.deferReply()
    const customTopic = interaction.options.getString('topic')

    try {
      const caps = await getActiveModelCapabilities()
      const fetchCount = caps.maxDigestMessages || 20
      const fetched = await interaction.channel.messages.fetch({ limit: fetchCount })
      const rawMessages = Array.from(fetched.values()).reverse()

      const formattedChat = rawMessages
        .filter(m => !m.author.bot)
        .map(m => `@${m.author.username}: ${m.content}`)
        .join('\n')

      const topicContext = customTopic ? `Topic/Question: "${customTopic}"` : 'Topic: Synthesize from recent channel discussion below.'

      const prompt = `${topicContext}\n\nRecent Channel Chat:\n\`\`\`\n${formattedChat.substring(0, 3000)}\n\`\`\`\n\n` +
        'Analyze the topic/chat and extract a Poll Question and 2 to 5 concise Poll Options.\n' +
        'Respond ONLY with valid JSON in this exact structure:\n' +
        '{\n' +
        '  "question": "The poll question (max 300 chars)",\n' +
        '  "options": ["Option 1", "Option 2", "Option 3"]\n' +
        '}'

      const messages = [
        { role: 'system', content: 'You are Skynet Poll Synthesizer. Respond strictly with JSON.' },
        { role: 'user', content: prompt }
      ]

      const result = await queryOllamaWithContext(messages, {
        guildId,
        userId: interaction.user.id
      })

      const responseText = result?.message?.content?.trim() || ''
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)

      let pollData = null
      if (jsonMatch) {
        try {
          pollData = JSON.parse(jsonMatch[0])
        } catch (parseErr) {
          logger.warn(`smart-poll: JSON parse error: ${parseErr.message}`)
        }
      }

      if (!pollData || !pollData.question || !Array.isArray(pollData.options) || pollData.options.length < 2) {
        // Fallback default if model returned invalid JSON
        pollData = {
          question: customTopic || `Community Vote: #${interaction.channel.name}`,
          options: ['Option A (Yes)', 'Option B (No)']
        }
      }

      // Ensure options are max 55 chars and max 5 options (Discord poll limits)
      const cleanQuestion = pollData.question.substring(0, 250)
      const cleanAnswers = pollData.options
        .slice(0, 5)
        .map(opt => ({ text: String(opt).substring(0, 55) }))

      logger.info(`smart-poll: Creating Discord Poll "${cleanQuestion}" with ${cleanAnswers.length} options`)

      // Delete deferred reply and post native poll in channel
      await interaction.deleteReply().catch(() => {})

      await interaction.channel.send({
        poll: {
          question: { text: cleanQuestion },
          answers: cleanAnswers,
          allowMultiselect: false,
          duration: 24
        }
      })
    } catch (err) {
      logger.error(`smart-poll error: ${err.message}`)
      return interaction.editReply({ content: `Failed to generate poll: ${err.message}` }).catch(() => {})
    }
  }
}
