const { MessageFlags } = require('discord.js')
const logger = require('../../logger')
const { THOUGHT_SCRUB_REGEX, BOILERPLATE_SCRUB_REGEX, ID_SCRUB_REGEX } = require('./constants')
const { splitMessage } = require('./splitMessage')

class DiscordResponder {
  constructor ({ botName }) {
    this.botName = botName || 'Bot'
  }

  async sendFinalResponse ({ interaction, replyContent, sharedState }) {
    const wasStreamed = (typeof interaction.streamToken?.hasEdited === 'function' && interaction.streamToken.hasEdited()) || false

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

    let anythingSent = false
    const chunks = splitMessage(replyContent)
    for (let i = 0; i < chunks.length; i++) {
      try {
        const cleanChunk = chunks[i]
          .replace(/<<<RUN_COMMAND:[\s\S]*?>>>/g, '')
          .replace(BOILERPLATE_SCRUB_REGEX, '')
          .replace(ID_SCRUB_REGEX, '')
          .replace(THOUGHT_SCRUB_REGEX, '')
          .trim()

        if (!cleanChunk && i === 0 && !sharedState.primaryResponseUsed) continue
        if (cleanChunk) anythingSent = true

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
              if (combinedText.length > 2000) {
                const subChunks = splitMessage(combinedText)
                for (let j = 0; j < subChunks.length; j++) {
                  if (j === 0) {
                    await interaction.editReply({ content: subChunks[j], flags: [MessageFlags.SuppressEmbeds] })
                  } else {
                    await interaction.followUp({ content: subChunks[j], flags: [MessageFlags.SuppressEmbeds] })
                  }
                }
              } else {
                await interaction.editReply({
                  content: combinedText,
                  flags: [MessageFlags.SuppressEmbeds]
                })
              }
            } else {
              // If literally no text, no embeds, and no background action needs confirming, delete.
              await interaction.deleteReply().catch(() => {})
            }
          }
        } else if (cleanChunk) {
          await interaction.followUp({ content: cleanChunk, flags: [MessageFlags.SuppressEmbeds] })
        }
      } catch (discordErr) {
        logger.error(`DiscordResponder: editReply/followUp failed (chunk ${i}): ${discordErr.message}`)
        const fallbackClean = chunks[i]
          .replace(/<<<RUN_COMMAND:[\s\S]*?>>>/g, '')
          .replace(BOILERPLATE_SCRUB_REGEX, '')
          .replace(/^\[ID: \d+\]\s*@[\w\d._-]+(?:\s*\([^)]+\))?:\s*/, '')
          .replace(THOUGHT_SCRUB_REGEX, '')
          .trim()

        if (fallbackClean) {
          // If we were streaming, try to fetch and edit the existing message instead of creating a new one
          if (wasStreamed && i === 0) {
            try {
              const existing = await interaction.fetchReply()
              if (existing && typeof existing.edit === 'function') {
                await existing.edit({ content: fallbackClean, flags: [MessageFlags.SuppressEmbeds] })
                continue
              }
            } catch (fetchErr) {
              logger.warn(`DiscordResponder: fetchReply fallback also failed: ${fetchErr.message}`)
            }
            // User already has the text from streaming. Do not spawn a duplicate channel.send.
            continue
          }
          await interaction.channel.send({ content: fallbackClean, flags: [MessageFlags.SuppressEmbeds] })
        }
      }
    }

    if (!anythingSent && !sharedState.primaryResponseUsed && !sharedState.visualActionExecuted) {
      await interaction.deleteReply().catch(() => {})
    }
  }
}

module.exports = DiscordResponder
