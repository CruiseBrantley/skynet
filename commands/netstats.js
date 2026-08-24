const { SlashCommandBuilder } = require('discord.js')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('netstats')
    .setDescription('Displays detailed bot network and latency statistics'),
  execute: async (interaction) => {
    const sent = await interaction.deferReply({ fetchReply: true })
    const sentTimestamp = sent?.createdTimestamp || Date.now()
    const interactionTimestamp = interaction?.createdTimestamp || Date.now()
    const roundtrip = Math.max(0, sentTimestamp - interactionTimestamp)
    const wsPing = interaction.client?.ws?.ping ?? 0
    const uptimeSec = Math.floor((interaction.client?.uptime || process.uptime() * 1000) / 1000)
    const hrs = Math.floor(uptimeSec / 3600)
    const mins = Math.floor((uptimeSec % 3600) / 60)
    const secs = uptimeSec % 60
    const guildCount = interaction.client?.guilds?.cache?.size ?? 0

    const embed = {
      title: 'Network Statistics',
      color: 0x008080,
      fields: [
        { name: 'WebSocket Heartbeat', value: `${wsPing} ms`, inline: true },
        { name: 'REST Roundtrip', value: `${roundtrip} ms`, inline: true },
        { name: 'Uptime', value: `${hrs}h ${mins}m ${secs}s`, inline: true },
        { name: 'Guilds Connected', value: `${guildCount}`, inline: true }
      ],
      footer: { text: 'Skynet Telemetry' }
    }

    await interaction.editReply({ embeds: [embed] })
  }
}
