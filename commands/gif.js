const { SlashCommandBuilder } = require('discord.js')

async function giphySearch (query) {
  const url = `https://api.giphy.com/v1/gifs/search?api_key=dc6zaTOxFJmzC&q=${encodeURIComponent(query)}&limit=1&rating=pg&lang=en`
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
  const data = await res.json()
  return data.data && data.data.length > 0 ? data.data[0] : null
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gif')
    .setDescription('Search and send an anime GIF by character and show')
    .addStringOption(opt => opt.setName('character').setDescription('Character name (e.g. Killua, Gojo, Levi)').setRequired(true))
    .addStringOption(opt => opt.setName('anime').setDescription('Anime/show name to scope the search (e.g. Hunter x Hunter, Jujutsu Kaisen)').setRequired(false))
    .addStringOption(opt => opt.setName('mood').setDescription('Optional mood or action (e.g. angry, happy, fighting, crying)').setRequired(false)),
  execute: async (interaction) => {
    const character = interaction.options.getString('character', true)
    const anime = interaction.options.getString('anime') || ''
    const mood = interaction.options.getString('mood') || ''
    const query = [character, anime, mood].filter(Boolean).join(' ')

    await interaction.deferReply()

    try {
      let gif = await giphySearch(query)
      let title = `${character}${anime ? ' — ' + anime : ''}${mood ? ' (' + mood + ')' : ''}`

      if (!gif) {
        const fallbackQuery = [character, mood].filter(Boolean).join(' ')
        gif = await giphySearch(fallbackQuery)
        title = `${character}${mood ? ' (' + mood + ')' : ''}`
      }

      if (gif) {
        await interaction.editReply({
          embeds: [{
            title,
            image: { url: gif.images.fixed_width.url },
            footer: { text: gif.title || 'Giphy' }
          }]
        })
      } else {
        await interaction.editReply(`No GIF found for **${query}**. Try different terms.`)
      }
    } catch (err) {
      await interaction.editReply(`GIF search failed: ${err.message}`)
    }
  }
}
