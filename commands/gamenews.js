// Auto-generated slash command: gamenews
// Created: 2026-08-19T02:26:13.341Z

const { SlashCommandBuilder } = require('discord.js')

module.exports = {
  guildId: '579210338352889867',
  data: new SlashCommandBuilder()
    .setName('gamenews')
    .setDescription('Fetch latest patch notes, hotfixes, and news for a tracked game')
    .addStringOption(opt => opt.setName('game').setDescription('Game to look up (e.g. Diablo 4, Monster Hunter, Project Zomboid, Helldivers 2, Path of Exile)').setRequired(true))
    .addChannelOption(opt => opt.setName('channel').setDescription('Target channel for the digest (defaults to current channel)').setRequired(false))
    .addBooleanOption(opt => opt.setName('brief').setDescription('Short 3-bullet TL;DR instead of full breakdown').setRequired(false)),
  execute: async (interaction) => {
    const game = interaction.options.getString('game', true)
    const target = interaction.options.getChannel('channel', false) || interaction.channel
    const brief = interaction.options.getBoolean('brief', false) || false

    await interaction.deferReply()

    const embed = {
      title: `\u{1F4F0} ${game} \u2014 News Digest`,
      description: brief
        ? `**TL;DR mode** \u2014 pulling top 3 items for **${game}**...`
        : `**Full breakdown** \u2014 compiling patch notes, hotfixes, and announcements for **${game}**...`,
      color: 0x2ecc71,
      footer: { text: `Requested by ${interaction.user.username} \u2022 ${new Date().toISOString().slice(0, 10)}` }
    }

    await target.send({ embeds: [embed] })
    await interaction.editReply(`Digest frame posted to **${target.name ? '#' + target.name : 'this channel'}**. Research incoming.`)
  }
}
