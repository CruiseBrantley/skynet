// Auto-generated slash command: netstats
// Created: 2026-08-17T23:29:47.141Z

const { SlashCommandBuilder } = require('discord.js')

module.exports = {
  guildId: '160135882274373633',
  data: new SlashCommandBuilder()
    .setName('netstats')
    .setDescription('Displays detailed bot network and latency statistics'),
  execute: async (interaction) => {
    const sent = await interaction.deferReply({ fetchReply: true }); const roundtrip = sent.createdTimestamp - interaction.createdTimestamp; const wsPing = interaction.client.ws.ping; const uptimeSec = Math.floor(interaction.client.uptime / 1000); const hrs = Math.floor(uptimeSec / 3600); const mins = Math.floor((uptimeSec % 3600) / 60); const secs = uptimeSec % 60; const embed = { title: 'Network Statistics', color: 0x008080, fields: [{ name: 'WebSocket Heartbeat', value: `${wsPing} ms`, inline: true }, { name: 'REST Roundtrip', value: `${roundtrip} ms`, inline: true }, { name: 'Uptime', value: `${hrs}h ${mins}m ${secs}s`, inline: true }, { name: 'Guilds Connected', value: `${interaction.client.guilds.cache.size}`, inline: true }], footer: { text: 'Skynet Telemetry' } }; await interaction.editReply({ embeds: [embed] })
  }
}
