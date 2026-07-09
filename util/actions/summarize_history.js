const logger = require('../../logger')
const { queryOllama } = require('../ollama')

module.exports = {
  name: 'summarize_history',
  description: 'Summarizes the recent conversation history in the current channel',
  schema: {
    count: 'number — the number of recent messages to summarize (default 20, max 100)',
    topic: 'string (optional) — a specific focus for the summary (e.g. "D&D plans")'
  },
  execute: async (bot, channel, params, context) => {
    let { count, topic } = params
    count = Math.min(Math.max(parseInt(count) || 20, 5), 100)

    try {
      logger.info(`ActionExecutor: Summarizing last ${count} messages in ${channel.id}${topic ? ` for topic: ${topic}` : ''}`)

      // Fetch messages
      const messages = await channel.messages.fetch({ limit: count })
      const historyText = messages
        .reverse()
        .map(m => `${m.member?.displayName || m.author.username}: ${m.content}`)
        .join('\n')

      if (!historyText) {
        if (context && typeof context.editReply === 'function') {
          return await context.editReply("I couldn't find any recent messages to summarize.")
        } else {
          return await channel.send("I couldn't find any recent messages to summarize.")
        }
      }

      const prompt = `Summarize the following Discord conversation history${topic ? ` focusing on: "${topic}"` : ''}. 
Keep the summary concise, using bullet points for key takeaways. 
Format with Discord markdown. Don't mention message IDs or timestamps.

Conversation History:
${historyText}`

      const result = await queryOllama('/api/chat', { messages: [{ role: 'user', content: prompt }] }, 2) // Force local for background tasks

      if (result && result.message && result.message.content) {
        const summary = result.message.content.trim()
        // Send as an embed for better visual quality
        const { EmbedBuilder } = require('discord.js')
        const embed = new EmbedBuilder()
          .setTitle(`📝 Summary: Last ${count} Messages`)
          .setDescription(summary)
          .setColor('#3498db')
          .setFooter({ text: `Focus: ${topic || 'General Context'}` })

        if (context && typeof context.editReply === 'function') {
          await context.editReply({ embeds: [embed] })
        } else {
          await channel.send({ embeds: [embed] })
        }
        logger.info('ActionExecutor: Summarization complete.')
      } else {
        throw new Error('AI failed to generate a summary.')
      }
    } catch (err) {
      logger.error(`ActionExecutor: Summarize history failed: ${err.message}`)
      throw err
    }
  }
}
