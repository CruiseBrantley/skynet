const logger = require('../../logger')

module.exports = {
  name: 'speak',
  description: 'Converts text to speech (TTS) and vocalizes it into the voice channel the user or bot is currently connected to.',
  schema: {
    text: {
      type: 'string',
      description: 'The message or words to speak aloud in the voice channel.'
    },
    voice_channel_id: {
      type: 'string',
      description: 'Optional Snowflake ID of the voice channel to join and speak in.'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const text = (params.text || params.message || '').trim()
    if (!text) {
      return { success: false, error: 'Parameter "text" is required.' }
    }

    try {
      const client = bot?.client || bot
      const guild = channel?.guild || (context.guildId && client?.guilds?.cache?.get(context.guildId))

      if (!guild) {
        return {
          success: false,
          error: 'Voice output requires an active Discord server (guild) context.'
        }
      }

      // Identify target voice channel
      let targetVoiceChannel = null
      if (params.voice_channel_id && guild.channels) {
        targetVoiceChannel = guild.channels.cache.get(params.voice_channel_id) ||
          (await guild.channels.fetch(params.voice_channel_id).catch(() => null))
      }

      if (!targetVoiceChannel && context.member?.voice?.channel) {
        targetVoiceChannel = context.member.voice.channel
      }

      if (!targetVoiceChannel && context.user?.id && guild.members) {
        const member = guild.members.cache.get(context.user.id) || await guild.members.fetch(context.user.id).catch(() => null)
        if (member?.voice?.channel) targetVoiceChannel = member.voice.channel
      }

      if (!targetVoiceChannel) {
        return {
          success: false,
          error: 'No active voice channel found. Please join a voice channel or specify voice_channel_id.'
        }
      }

      // Delegate to speak command execution flow
      const speakCommand = require('../../commands/speak')
      const simulatedInteraction = {
        guild,
        guildId: guild.id,
        member: context.member || { voice: { channel: targetVoiceChannel } },
        client,
        options: {
          getString: (name) => {
            if (name === 'text') return text
            return null
          }
        },
        deferReply: async () => {},
        editReply: async () => {},
        reply: async () => {}
      }

      await speakCommand.execute(simulatedInteraction, context.database)
      logger.info(`speak: Spoke "${text.substring(0, 50)}" in voice channel ${targetVoiceChannel.name || targetVoiceChannel.id}`)

      return {
        success: true,
        text,
        channelId: targetVoiceChannel.id,
        spoken: true
      }
    } catch (err) {
      logger.error(`speak action failed: ${err.message}`)
      return { success: false, error: `Failed to speak audio in voice channel: ${err.message}` }
    }
  }
}
