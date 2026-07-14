const axios = require('axios')
const logger = require('../../logger')

// Curated list of high-quality generic reaction GIFs to use when Giphy API key is missing
const CURATED_FALLBACK_GIFS = {
  happy: [
    'https://media.giphy.com/media/l3q2zVr6cu95nF6O4/giphy.gif', // Minion happy
    'https://media.giphy.com/media/t3s3BLmFAjVW8/giphy.gif', // Spongebob happy
    'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif' // Carlton dance / happy
  ],
  sad: [
    'https://media.giphy.com/media/9Y5BbDSkSTiY8/giphy.gif', // Sad puppy
    'https://media.giphy.com/media/2WxWlkKWUsQhy/giphy.gif', // Sad doctor who
    'https://media.giphy.com/media/d2lcHJTG5Tscg/giphy.gif' // Crying face
  ],
  facepalm: [
    'https://media.giphy.com/media/3og0INyMrrC6cyUM80/giphy.gif', // Facepalm
    'https://media.giphy.com/media/w89ak63KNl0n6/giphy.gif', // Star Trek facepalm
    'https://media.giphy.com/media/1tHzw9PXX3eCs/giphy.gif' // Animated facepalm
  ],
  shock: [
    'https://media.giphy.com/media/jivGiBTdqvZOg/giphy.gif', // Shocked cat
    'https://media.giphy.com/media/PUBxelwT57jsQ/giphy.gif', // Shocked kid
    'https://media.giphy.com/media/cl90q5wYv8lsQ/giphy.gif' // Shocked Minion
  ],
  popcorn: [
    'https://media.giphy.com/media/pUeXcg80c58I/giphy.gif', // Michael Jackson eating popcorn
    'https://media.giphy.com/media/hVTouqNmVKiMo/giphy.gif', // Popcorn reaction
    'https://media.giphy.com/media/NipFetnQeYYTu/giphy.gif' // Eating popcorn
  ],
  dance: [
    'https://media.giphy.com/media/13xsE7W54k7szo/giphy.gif', // Carlton dance
    'https://media.giphy.com/media/5GovlcmPQTeGQ/giphy.gif', // Excited dance
    'https://media.giphy.com/media/l3V0lsGtTMSB5YNgA/giphy.gif' // Dance party
  ],
  think: [
    'https://media.giphy.com/media/a5viI92UXDSKY/giphy.gif', // Thinking face
    'https://media.giphy.com/media/3o7qE1YN7aBOFPRw8E/giphy.gif', // Thinking Minion
    'https://media.giphy.com/media/d3mlYqJJ9RfmkwKs/giphy.gif' // Smart guy tapping head
  ],
  shrug: [
    'https://media.giphy.com/media/jPAdK8LY2Wv7TdlwOP/giphy.gif', // Shrug kid
    'https://media.giphy.com/media/G5X6MzyxjAnK/giphy.gif', // Spongebob shrug
    'https://media.giphy.com/media/14aUO0Mf7dWDXW/giphy.gif' // Shrug animation
  ]
}

// Supported nekos.best categories
const NEKO_CATEGORIES = [
  'hug', 'pat', 'kiss', 'cuddle', 'slap', 'bite', 'tickle', 'poke', 'wave', 'smile',
  'laugh', 'blush', 'bored', 'shrug', 'happy', 'sad', 'smug', 'dance', 'yeet', 'think',
  'cry', 'highfive', 'nod', 'nope', 'stare', 'punch', 'wasted', 'run', 'crying', 'feed'
]

/**
 * Maps query keywords to supported nekos.best reaction categories.
 */
function getBestNekoCategory (query) {
  const clean = (query || '').toLowerCase()

  if (clean.includes('cry') || clean.includes('weep') || clean.includes('tear')) return 'cry'
  if (clean.includes('sad') || clean.includes('depress')) return 'sad'
  if (clean.includes('laugh') || clean.includes('funny') || clean.includes('lol') || clean.includes('haha')) return 'laugh'
  if (clean.includes('smile') || clean.includes('grin')) return 'smile'
  if (clean.includes('happy') || clean.includes('excited') || clean.includes('joy')) return 'happy'
  if (clean.includes('shrug') || clean.includes('meh')) return 'shrug'
  if (clean.includes('bored') || clean.includes('tired')) return 'bored'
  if (clean.includes('dance') || clean.includes('groove')) return 'dance'
  if (clean.includes('think') || clean.includes('ponder') || clean.includes('hmm')) return 'think'
  if (clean.includes('nod') || clean.includes('yes') || clean.includes('agree')) return 'nod'
  if (clean.includes('no') || clean.includes('nope') || clean.includes('disagree')) return 'nope'
  if (clean.includes('stare') || clean.includes('watch') || clean.includes('look')) return 'stare'
  if (clean.includes('punch') || clean.includes('hit') || clean.includes('fight')) return 'punch'
  if (clean.includes('slap')) return 'slap'
  if (clean.includes('hug') || clean.includes('cuddle')) return 'hug'
  if (clean.includes('wasted') || clean.includes('dead') || clean.includes('fail')) return 'wasted'
  if (clean.includes('run') || clean.includes('escape')) return 'run'
  if (clean.includes('wave') || clean.includes('hello') || clean.includes('hi')) return 'wave'
  if (clean.includes('highfive')) return 'highfive'

  // Substring fallback checks
  for (const cat of NEKO_CATEGORIES) {
    if (clean.includes(cat)) return cat
  }

  // Random fallback if no keyword matches
  const randIdx = Math.floor(Math.random() * NEKO_CATEGORIES.length)
  return NEKO_CATEGORIES[randIdx]
}

/**
 * Maps query keywords to generic curated fallback categories.
 */
function getGenericFallbackCategory (query) {
  const clean = (query || '').toLowerCase()

  if (clean.includes('happy') || clean.includes('excited') || clean.includes('joy') || clean.includes('smile')) return 'happy'
  if (clean.includes('sad') || clean.includes('cry') || clean.includes('weep')) return 'sad'
  if (clean.includes('facepalm') || clean.includes('fail') || clean.includes('stupid')) return 'facepalm'
  if (clean.includes('shock') || clean.includes('surprise') || clean.includes('what') || clean.includes('omg')) return 'shock'
  if (clean.includes('popcorn') || clean.includes('drama') || clean.includes('interesting')) return 'popcorn'
  if (clean.includes('dance') || clean.includes('celebrate') || clean.includes('party')) return 'dance'
  if (clean.includes('think') || clean.includes('ponder') || clean.includes('hmm') || clean.includes('question')) return 'think'
  if (clean.includes('shrug') || clean.includes('meh') || clean.includes('whatever')) return 'shrug'

  // Pick a random category
  const categories = Object.keys(CURATED_FALLBACK_GIFS)
  const randIdx = Math.floor(Math.random() * categories.length)
  return categories[randIdx]
}

/**
 * Service to fetch GIF URLs based on guild settings and search queries.
 */
class GifService {
  /**
   * Retrieves the GIF theme setting for a specific guild.
   * @param {string} guildId
   * @returns {Promise<string>} 'default', 'anime', or 'disabled'
   */
  async getThemeSetting (guildId) {
    if (!guildId) return 'default'
    try {
      const firebaseLogin = require('../../firebase-login')
      const database = firebaseLogin()
      const snapshot = await database.ref(`guild_settings/${guildId}/gif_theme`).once('value')
      return snapshot.val() || 'default'
    } catch (err) {
      logger.warn(`GifService: Failed to fetch gif_theme for guild ${guildId}: ${err.message}`)
      return 'default'
    }
  }

  /**
   * Main entry point to get a GIF URL.
   * @param {string} query
   * @param {string} guildId
   * @returns {Promise<string|null>} The GIF URL or null if disabled
   */
  async getGif (query, guildId) {
    const theme = await this.getThemeSetting(guildId)
    if (theme === 'disabled') {
      logger.info(`GifService: GIFs are disabled for guild ${guildId}. Skipping.`)
      return null
    }

    const cleanQuery = (query || '').trim()

    // ─── Phase 1: GIPHY API (If Key Exists) ───
    if (process.env.GIPHY_API_KEY) {
      let searchQuery = cleanQuery
      if (theme === 'anime') {
        searchQuery += ' anime'
      }

      try {
        const url = `https://api.giphy.com/v1/gifs/search?api_key=${process.env.GIPHY_API_KEY}&q=${encodeURIComponent(searchQuery)}&limit=5`
        const response = await axios.get(url)
        const data = response.data?.data
        if (data && data.length > 0) {
          const randIdx = Math.floor(Math.random() * Math.min(data.length, 5))
          const gifUrl = data[randIdx].images?.original?.url
          if (gifUrl) {
            return gifUrl
          }
        }
      } catch (err) {
        logger.error(`GifService: GIPHY API failed: ${err.message}`)
      }
    }

    // ─── Phase 2: Fallbacks (No API Key or Request Failed) ───

    // Anime Fallback via nekos.best
    if (theme === 'anime' || cleanQuery.toLowerCase().includes('anime') || cleanQuery.toLowerCase().includes('otaku')) {
      try {
        const category = getBestNekoCategory(cleanQuery)
        const url = `https://nekos.best/api/v2/${category}`
        logger.info(`GifService: Fetching anime GIF from nekos.best category: "${category}"`)
        const response = await axios.get(url)
        const gifUrl = response.data?.results?.[0]?.url
        if (gifUrl) {
          return gifUrl
        }
      } catch (err) {
        logger.error(`GifService: nekos.best fetch failed: ${err.message}`)
      }
    }

    // Generic Curated Fallback
    const category = getGenericFallbackCategory(cleanQuery)
    const list = CURATED_FALLBACK_GIFS[category]
    const randIdx = Math.floor(Math.random() * list.length)
    const fallbackUrl = list[randIdx]

    logger.info(`GifService: Using generic fallback GIF from category: "${category}"`)
    return fallbackUrl
  }
}

module.exports = new GifService()
