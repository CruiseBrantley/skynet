// Auto-generated slash command: animemood
// Created: 2026-08-18T06:07:54.466Z

const { SlashCommandBuilder } = require('discord.js')

module.exports = {
  guildId: '111277280432508928',
  data: new SlashCommandBuilder()
    .setName('animemood')
    .setDescription('Pulls an anime GIF that matches the current mood of the channel')
    .addStringOption(opt => opt.setName('mood').setDescription('Override the auto-detected mood (e.g. hype, angry, cute, sad, shocked, funny)').setRequired(false)),
  execute: async (interaction) => {
    let mood = interaction.options.getString('mood')
    await interaction.deferReply()

    if (!mood) {
      try {
        const messages = await interaction.channel.messages.fetch({ limit: 15 })
        const recent = messages.map(m => m.content).join(' ').toLowerCase()
        if (recent.includes('lol') || recent.includes('lmao') || recent.includes('😂') || recent.includes('🤣') || recent.includes('funny')) mood = 'funny'
        else if (recent.includes('mad') || recent.includes('angry') || recent.includes('rage') || recent.includes('tilt') || recent.includes('hit')) mood = 'angry'
        else if (recent.includes('love') || recent.includes('❤') || recent.includes('cute') || recent.includes('sweet')) mood = 'cute'
        else if (recent.includes('hype') || recent.includes('fire') || recent.includes('🔥') || recent.includes('slay') || recent.includes('works for me')) mood = 'hype'
        else if (recent.includes('sad') || recent.includes('cry') || recent.includes('😢') || recent.includes('miss')) mood = 'sad'
        else if (recent.includes('???') || recent.includes('tf ') || recent.includes('what') || recent.includes('happened')) mood = 'shocked'
        else mood = 'hype'
      } catch { mood = 'hype' }
    }

    const url = `https://api.giphy.com/v1/gifs/search?api_key=dc6zaTOxFJmzC&q=${encodeURIComponent('anime ' + mood)}&limit=1&rating=pg&lang=en`
    const res = await fetch(url)
    const data = await res.json()

    if (data.data && data.data.length > 0) {
      const gif = data.data[0]
      await interaction.editReply({
        content: `**Mood:** ${mood}`,
        embeds: [{
          title: `Anime Mood: ${mood}`,
          image: { url: gif.images.fixed_width.url },
          footer: { text: gif.title || 'Giphy' }
        }]
      })
    } else {
      await interaction.editReply(`No anime GIF found for "${mood}". Try specifying a mood manually.`)
    }
  }
}
