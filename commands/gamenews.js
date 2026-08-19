// Auto-generated slash command: gamenews
// Updated: 2026-08-19

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js')
const axios = require('axios')

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

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      await interaction.editReply('Error: GEMINI_API_KEY is not configured on the bot.')
      return
    }

    try {
      const prompt = `Provide the latest patch notes, hotfixes, updates, and current news for the video game "${game}". ${
        brief
          ? 'Provide a concise 3-to-4 bullet point TL;DR of the most recent patch and balance changes.'
          : 'Provide the latest patch version, release date, main features, balance adjustments, and bug fixes.'
      } Format clearly with readable markdown bullet points.`

      let content = null
      let sources = []

      const candidateModels = ['gemini-2.5-flash', 'gemini-3.7-flash', 'gemini-2.0-flash']
      for (const model of candidateModels) {
        try {
          const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
              contents: [{ parts: [{ text: prompt }] }],
              tools: [{ googleSearch: {} }]
            },
            { timeout: 60000 }
          )

          const candidate = res.data.candidates?.[0]
          const text = candidate?.content?.parts?.[0]?.text
          if (text && text.trim().length > 0) {
            content = text.trim()
            const chunks = candidate.groundingMetadata?.groundingChunks || []
            sources = chunks
              .filter(c => c.web?.uri)
              .map(c => `[${c.web.title || 'Source'}](${c.web.uri})`)
              .slice(0, 4)
            break
          }
        } catch (apiErr) {
          // Cascade to next model
        }
      }

      if (!content) {
        await interaction.editReply(`Could not retrieve recent patch notes or news for **${game}**.`)
        return
      }

      // Truncate description to fit Discord embed limit (4096 chars)
      let desc = content
      if (desc.length > 3500) {
        desc = desc.substring(0, 3450) + '...\n\n*(Summary truncated for length)*'
      }

      const embed = new EmbedBuilder()
        .setTitle(`📰 ${game} — Latest News & Patch Notes`)
        .setDescription(desc)
        .setColor(0x2ecc71)
        .setTimestamp()
        .setFooter({ text: `Requested by ${interaction.user.username}` })

      if (sources.length > 0) {
        let sourceText = sources.join(' • ')
        if (sourceText.length > 1000) {
          sourceText = sources.slice(0, 2).join(' • ')
        }
        if (sourceText.length > 1000) {
          sourceText = sourceText.substring(0, 990) + '...'
        }
        embed.addFields({ name: '🔗 Sources & Official Notes', value: sourceText, inline: false })
      }

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
