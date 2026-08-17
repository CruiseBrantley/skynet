// Auto-generated slash command: weather
// Created: 2026-08-17T23:05:41.432Z

const { SlashCommandBuilder } = require('discord.js')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weather')
    .setDescription('Get a current weather report for a city')
    .addStringOption(opt => opt.setName('city').setDescription('City name to look up (e.g. Fayetteville, Tokyo)').setRequired(true)),
  execute: async (interaction) => {
    const city = interaction.options.getString('city', true)
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`)
    const geoData = await geoRes.json()
    if (!geoData.results || geoData.results.length === 0) {
      return await interaction.reply(`City "${city}" not found. Try a more specific name.`)
    }
    const { latitude, longitude, name, country, admin1 } = geoData.results[0]
    const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`)
    const w = await wRes.json()
    const c = w.current
    const d = w.daily
    const codes = { 0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle', 56: 'Light freezing drizzle', 57: 'Dense freezing drizzle', 61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain', 66: 'Light freezing rain', 67: 'Heavy freezing rain', 71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Slight showers', 81: 'Moderate showers', 82: 'Violent showers', 85: 'Slight snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Thunderstorm w/ heavy hail' }
    const desc = codes[c.weather_code] || 'Unknown'
    const f = (c2) => Math.round(c2 * 9 / 5 + 32)
    const loc = [name, admin1, country].filter(Boolean).join(', ')
    await interaction.reply(`**${loc}**\n${desc}\n**${f(c.temperature_2m)}°F** (feels like ${f(c.apparent_temperature)}°F)\nHumidity: ${c.relative_humidity_2m}%\nWind: ${Math.round(c.wind_speed_10m * 0.621)} mph\nPrecip chance: ${d.precipitation_probability_max ? d.precipitation_probability_max[0] + '%' : 'N/A'}\nToday: ${f(d.temperature_2m_min[0])}°F – ${f(d.temperature_2m_max[0])}°F`)
  }
}
