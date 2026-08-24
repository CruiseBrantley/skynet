const { MessageFlags } = require('discord.js')

// Helper to build a mock interaction for autonomous command execution
function createMockInteraction (interaction, optionsOverrides = {}, onOutput = null, sharedState = { primaryResponseUsed: false, primaryContent: '' }) {
  const capture = async (msg) => {
    const isString = typeof msg === 'string'
    const str = isString ? msg : (msg?.content || '')
    const hasEmbeds = !isString && msg?.embeds && msg.embeds.length > 0

    if (str || hasEmbeds) {
      if (onOutput && str) onOutput(str)

      // For merging purposes, we track if there's text
      const currentContent = typeof sharedState.primaryContent === 'string' ? sharedState.primaryContent : (sharedState.primaryContent?.content || '')
      const combinedText = currentContent ? (currentContent + '\n' + str) : str

      if (!sharedState.primaryResponseUsed) {
        sharedState.primaryResponseUsed = true
        sharedState.primaryContent = msg // Store the full object (embeds and all)
        await interaction.editReply(msg)
      } else if (!hasEmbeds && combinedText.length < 2000) {
        // If it's just text and it fits, merge with existing text if there are NO EMBEDS
        const currentIsEmbed = sharedState.primaryContent?.embeds?.length > 0
        if (!currentIsEmbed) {
          sharedState.primaryContent = combinedText
          await interaction.editReply({ content: combinedText, flags: [MessageFlags.SuppressEmbeds] })
        } else {
          await interaction.followUp({ content: str, flags: [MessageFlags.SuppressEmbeds] })
        }
      } else {
        await interaction.followUp(msg)
      }
    }
    return { createdTimestamp: Date.now() }
  }

  return {
    id: interaction.id,
    client: interaction.client,
    user: interaction.user,
    member: interaction.member,
    channelId: interaction.channelId,
    channel: interaction.channel,
    guild: interaction.guild,
    guildId: interaction.guildId,
    createdTimestamp: interaction.createdTimestamp || Date.now(),
    options: {
      getString: () => null,
      getChannel: () => null,
      getAttachment: () => null,
      getBoolean: () => false,
      getInteger: () => null,
      getMember: () => null,
      getUser: () => null,
      getSubcommand: () => null,
      getSubcommandGroup: () => null,
      ...optionsOverrides
    },
    reply: capture,
    deferReply: async () => ({ createdTimestamp: Date.now() }),
    editReply: capture,
    followUp: capture,
    deleteReply: async () => {
      sharedState.primaryResponseUsed = false
      sharedState.primaryContent = ''
      return interaction.deleteReply().catch(() => {})
    },
    toString () {
      const ch = (this.channel || interaction.channel)
      if (ch && typeof ch.toString === 'function') {
        const s = ch.toString()
        if (s && s !== '[object Object]') return s
        if (ch.name) return `#${ch.name}`
      }
      return '[Unknown Channel]'
    }
  }
}

module.exports = { createMockInteraction }
