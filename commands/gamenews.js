// Auto-generated slash command: gamenews
// Updated: 2026-08-19

const { SlashCommandBuilder } = require('discord.js')
const { SafeEmbedBuilder: EmbedBuilder } = require('../util/discordFormatter')
const ActionExecutor = require('../util/ActionExecutor')

module.exports = {
  guildId: '579210338352889867',
  data: new SlashCommandBuilder()
    .setName('gamenews')
    .setDescription('Fetch latest patch notes, hotfixes, and news for a tracked game')
    .addStringOption(opt => opt.setName('game').setDescription('Game to look up (e.g. Diablo 4, Monster Hunter, Helldivers 2, PoE, WoW, etc.)').setRequired(true))
    .addChannelOption(opt => opt.setName('channel').setDescription('Target channel for the digest (defaults to current channel)').setRequired(false))
    .addBooleanOption(opt => opt.setName('brief').setDescription('Short 3-bullet TL;DR instead of full breakdown').setRequired(false)),
  execute: async (interaction) => {
    const game = interaction.options.getString('game', true).trim()
    const target = interaction.options.getChannel('channel', false) || interaction.channel
    const brief = interaction.options.getBoolean('brief', false) || false

    await interaction.deferReply()

    try {
      const prompt = `Provide the latest patch notes, hotfixes, updates, and current news for the video game "${game}". ${
        brief
          ? 'Provide a concise 3-to-4 bullet point TL;DR of the most recent patch and balance changes.'
          : 'Provide the latest patch version, release date, main features, balance adjustments, and bug fixes.'
      } Format clearly with readable markdown bullet points.`

      const searchRes = await ActionExecutor.executeAction('web_search', { query: prompt }, interaction)
      const content = searchRes.output || searchRes.result

      if (!content) {
        await interaction.editReply(`Could not retrieve recent patch notes or news for **${game}**.`)
        return
      }

      const embed = new EmbedBuilder()
        .setTitle(`📰 ${game} — Latest News & Patch Notes`)
        .setDescription(content)
        .setColor(0x2ecc71)
        .setTimestamp()
        .setFooter({ text: `Requested by ${interaction.user.username}` })

      if (target.id !== interaction.channelId) {
        await target.send({ embeds: [embed] })
        await interaction.editReply(`Digest posted to **<#${target.id}>**.`)
      } else {
        await interaction.editReply({ embeds: [embed] })
      }
    } catch (err) {
      await interaction.editReply(`Error fetching news for **${game}**: ${err.message}`)
    }
  }
}
