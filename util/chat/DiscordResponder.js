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

    const cleanReply = (replyContent || '')
      .replace(/<think[\s\S]*?(?:<\/think>|$)/gi, '')
      .replace(/<thought[\s\S]*?(?:<\/thought>|$)/gi, '')
      .replace(/<<<RUN_COMMAND:[\s\S]*?>>>/g, '')
      .replace(BOILERPLATE_SCRUB_REGEX, '')
      .replace(ID_SCRUB_REGEX, '')
      .replace(THOUGHT_SCRUB_REGEX, '')
      .replace(/\*.*(?:is thinking\.\.\.|is autonomously executing).*\*(\s*\(\d+s\))?/gi, '')
      .replace(/^[•✓]\s+.*$/gm, '')
      .trim()

    // 1. Proactive interjection responses: strictly single message, max 400 chars, no follow-ups
    if (interaction.isProactive) {
      if (!cleanReply) {
        await interaction.deleteReply().catch(() => {})
        return
      }
      const proactiveContent = cleanReply.length > 400 ? cleanReply.slice(0, 400).trim() : cleanReply
      try {
        await interaction.editReply({ content: proactiveContent, flags: [MessageFlags.SuppressEmbeds] })
      } catch (err) {
        logger.error(`DiscordResponder (proactive): editReply failed: ${err.message}`)
        if (!wasStreamed) {
          await interaction.channel.send({ content: proactiveContent, flags: [MessageFlags.SuppressEmbeds] }).catch(() => {})
        }
      }
      return
    }

    // 2. Empty / silent AI response
    if (!cleanReply) {
      if (sharedState.primaryResponseUsed && !sharedState.visualActionExecuted) {
        try {
          const reply = await interaction.fetchReply()
          await reply.react('✅').catch(() => {})
        } catch (err) {
          await interaction.editReply({ content: '\u200B' }).catch(() => {})
        }
        return
      }

      if (sharedState.primaryResponseUsed) {
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

    // 3. Extract and clean any existing primary content or embeds
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

    const cleanOriginal = originalText
      .replace(/\*.*(?:is autonomously executing|is thinking\.\.\.).*\*(\s*\(\d+s\))?/gi, '')
      .replace(/^[•✓]\s+.*$/gm, '')
      .replace(THOUGHT_SCRUB_REGEX, '')
      .trim()

    // 4. If embeds exist on the primary reply, preserve them
    if (sharedState.primaryResponseUsed && originalEmbeds.length > 0) {
      const combinedText = (cleanReply && cleanOriginal) ? (cleanReply + '\n' + cleanOriginal) : (cleanReply || cleanOriginal)

      if (combinedText.length <= 2000) {
        await interaction.editReply({
          content: combinedText,
          embeds: originalEmbeds
        })
      } else {
        const chunks = splitMessage(cleanReply)
        for (const chunk of chunks) {
          await interaction.followUp({ content: chunk, flags: [MessageFlags.SuppressEmbeds] })
        }
      }
      return
    }

    // 5. Standard text delivery: single-pass split of combined text
    const combinedText = (cleanReply && cleanOriginal) ? (cleanReply + '\n' + cleanOriginal) : (cleanReply || cleanOriginal)
    sharedState.primaryResponseUsed = true
    sharedState.primaryContent = combinedText

    const chunks = splitMessage(combinedText)
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i].trim()
      if (!chunk) continue
      try {
        if (i === 0) {
          await interaction.editReply({ content: chunk, flags: [MessageFlags.SuppressEmbeds] })
        } else {
          await interaction.followUp({ content: chunk, flags: [MessageFlags.SuppressEmbeds] })
        }
      } catch (discordErr) {
        logger.error(`DiscordResponder: editReply/followUp failed (chunk ${i}): ${discordErr.message}`)
        if (wasStreamed && i === 0) {
          try {
            const existing = await interaction.fetchReply()
            if (existing && typeof existing.edit === 'function') {
              await existing.edit({ content: chunk, flags: [MessageFlags.SuppressEmbeds] })
              continue
            }
          } catch (fetchErr) {
            logger.warn(`DiscordResponder: fetchReply fallback also failed: ${fetchErr.message}`)
          }
          continue
        }
        try {
          await interaction.channel.send({ content: chunk, flags: [MessageFlags.SuppressEmbeds] })
        } catch (sendErr) {
          logger.error(`DiscordResponder: channel.send fallback failed: ${sendErr.message}`)
        }
      }
    }
  }
}

module.exports = DiscordResponder
