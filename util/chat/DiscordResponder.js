const { MessageFlags } = require('discord.js')
const logger = require('../../logger')
const { THOUGHT_SCRUB_REGEX } = require('./constants')
const { splitMessage } = require('./splitMessage')

class DiscordResponder {
  constructor ({ botName }) {
    this.botName = botName || 'Bot'
  }

  async sendFinalResponse ({ interaction, replyContent, sharedState }) {
    if (!replyContent || replyContent.length === 0) {
      // AI didn't provide a final summary string.
      if (sharedState.primaryResponseUsed && !sharedState.visualActionExecuted) {
        try {
          const reply = await interaction.fetchReply()
          await reply.react('✅').catch(() => {})
        } catch (err) {
          // If we can't react, fallback to a very subtle empty non-breaking space
          await interaction.editReply({ content: '\u200B' }).catch(() => {})
        }
        return
      }

      if (sharedState.primaryResponseUsed) {
        // Determine if we need to preserve existing embeds
        let originalEmbeds = []
        if (sharedState.primaryContent && typeof sharedState.primaryContent !== 'string') {
          originalEmbeds = sharedState.primaryContent.embeds || []
        }

        if (originalEmbeds.length > 0) {
          await interaction.editReply({
            content: '',
            embeds: originalEmbeds
          }).catch(() => {})
        } else {
          await interaction.deleteReply().catch(() => {})
        }
      } else {
        await interaction.deleteReply().catch(() => {})
      }
      return
    }

    const chunks = splitMessage(replyContent)
    for (let i = 0; i < chunks.length; i++) {
      try {
        const cleanChunk = chunks[i]
          .replace(/<<<RUN_COMMAND:[\s\S]*?>>>/g, '')
          .replace(/^\[ID: \d+\]\s*@[\w\d._-]+(?:\s*\([^)]+\))?:\s*/, '')
          .replace(THOUGHT_SCRUB_REGEX, '')
          .trim()

        if (!cleanChunk && i === 0 && !sharedState.primaryResponseUsed) continue

        if (i === 0) {
          // Extract any existing content or embeds
          let originalText = ''
          let originalEmbeds = []

          if (sharedState.primaryContent) {
            if (typeof sharedState.primaryContent === 'string') {
              originalText = sharedState.primaryContent
            } else {
              originalText = sharedState.primaryContent.content || ''
              originalEmbeds = sharedState.primaryContent.embeds || []
            }
          }

          // Clean status messages from the original text
          const cleanOriginal = originalText
            .replace(/\*.*is autonomously executing.*\*/g, '')
            .replace(THOUGHT_SCRUB_REGEX, '')
            .trim()

          if (sharedState.primaryResponseUsed && originalEmbeds.length > 0) {
            // If we already have embeds, we MERGE the text into the primary reply
            // as long as it fits, preserving the visuals.
            const combinedText = (cleanChunk && cleanOriginal) ? (cleanChunk + '\n' + cleanOriginal) : (cleanChunk || cleanOriginal)

            // If the merged text is too long (>2000), THEN we followUp.
            if (combinedText.length > 2000) {
              await interaction.followUp({ content: cleanChunk, flags: [MessageFlags.SuppressEmbeds] })
            } else {
              // Prefer the combined text, but allow empty content if embeds are present
              await interaction.editReply({
                content: combinedText || '',
                embeds: originalEmbeds
              })
            }
          } else {
            // No embeds? We merge the text or overwrite the status message.
            const combinedText = (cleanChunk && cleanOriginal) ? (cleanChunk + '\n' + cleanOriginal) : (cleanChunk || cleanOriginal)
            sharedState.primaryResponseUsed = true
            sharedState.primaryContent = combinedText

            // Fallback: If the AI was completely silent but we executed a background action,
            // react to the bot's own message (or the invocation) to indicate completion
            // without cluttering the chat with a "Task complete" message.
            if (!combinedText && sharedState.primaryResponseUsed && !sharedState.visualActionExecuted) {
              try {
                const reply = await interaction.fetchReply()
                await reply.react('✅').catch(() => {})
              } catch (err) {
                // If we can't react, fallback to a very subtle empty non-breaking space
                // to prevent the "thinking" message from being deleted too early.
                await interaction.editReply({ content: '\u200B' }).catch(() => {})
              }
            } else if (combinedText) {
              await interaction.editReply({
                content: combinedText,
                flags: [MessageFlags.SuppressEmbeds]
              })
            } else {
              // If literally no text, no embeds, and no background action needs confirming, delete.
              await interaction.deleteReply().catch(() => {})
            }
          }
        } else {
          await interaction.followUp({ content: chunks[i], flags: [MessageFlags.SuppressEmbeds] })
        }
      } catch (discordErr) {
        const fallbackClean = chunks[i]
          .replace(/<<<RUN_COMMAND:[\s\S]*?>>>/g, '')
          .replace(/^\[ID: \d+\]\s*@[\w\d._-]+(?:\s*\([^)]+\))?:\s*/, '')
          .replace(THOUGHT_SCRUB_REGEX, '')
          .trim()

        if (fallbackClean) {
          logger.info('Interaction reply failed, falling back to channel.send: ' + discordErr.message)
          await interaction.channel.send({ content: fallbackClean, flags: [MessageFlags.SuppressEmbeds] })
        }
      }
    }
  }
}

module.exports = DiscordResponder
