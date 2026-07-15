const axios = require('axios')
const logger = require('../../logger')

// Curated list of high-quality generic reaction GIFs to use when Giphy API key is missing
const CURATED_FALLBACK_GIFS = {
  happy: [
    'https://media2.giphy.com/media/v1.Y2lkPTc0MTM1NmMzZzU0b2RrNTE5czl0ZXYzNmExeG9xdGlmMTRhYjhxbW8yMG51YWEyeSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/BWplyaNrHRjRvweNjS/giphy.gif',
    'https://media3.giphy.com/media/v1.Y2lkPTc0MTM1NmMzZzU0b2RrNTE5czl0ZXYzNmExeG9xdGlmMTRhYjhxbW8yMG51YWEyeSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/3o7qE2VAxuXWeyvJIY/giphy.gif',
    'https://media1.giphy.com/media/v1.Y2lkPTc0MTM1NmMzZzU0b2RrNTE5czl0ZXYzNmExeG9xdGlmMTRhYjhxbW8yMG51YWEyeSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/aQYR1p8saOQla/giphy.gif'
  ],
  sad: [
    'https://media0.giphy.com/media/v1.Y2lkPTc0MTM1NmMzNmF3OXFhY2cwYmUwY3hva3lwbzh5Y2N2Y2J0bmd5amFwcTU3dHVveSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/lGBecpB2dIMwt6ohfI/giphy.gif',
    'https://media4.giphy.com/media/v1.Y2lkPTc0MTM1NmMzNmF3OXFhY2cwYmUwY3hva3lwbzh5Y2N2Y2J0bmd5amFwcTU3dHVveSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/q2qxiBO5prG9i/giphy.gif',
    'https://media0.giphy.com/media/v1.Y2lkPTc0MTM1NmMzNmF3OXFhY2cwYmUwY3hva3lwbzh5Y2N2Y2J0bmd5amFwcTU3dHVveSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/H6cmWzp6LGFvqjidB7/giphy.gif'
  ],
  facepalm: [
    'https://media0.giphy.com/media/v1.Y2lkPTc0MTM1NmMzOGM0ZWoyMXc4Nzk1MTNsZXEyNTh5OWgwbmVsYms0OHA3M3V2NGpmeSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/XD4qHZpkyUFfq/giphy.gif',
    'https://media0.giphy.com/media/v1.Y2lkPTc0MTM1NmMzOGM0ZWoyMXc4Nzk1MTNsZXEyNTh5OWgwbmVsYms0OHA3M3V2NGpmeSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/Ra1bmpxpsppNC/giphy.gif',
    'https://media3.giphy.com/media/v1.Y2lkPTc0MTM1NmMzOGM0ZWoyMXc4Nzk1MTNsZXEyNTh5OWgwbmVsYms0OHA3M3V2NGpmeSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/vwI4mYEHP8k0w/giphy.gif'
  ],
  shock: [
    'https://media2.giphy.com/media/v1.Y2lkPTc0MTM1NmMzeWpuMTF5YnFnbDJyZWpydHJya3pscGd0YWV6dDBnbzZ1aGh6MnZqcSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/5VKbvrjxpVJCM/giphy.gif',
    'https://media4.giphy.com/media/v1.Y2lkPTc0MTM1NmMzeWpuMTF5YnFnbDJyZWpydHJya3pscGd0YWV6dDBnbzZ1aGh6MnZqcSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/l3q2K5jinAlChoCLS/giphy.gif',
    'https://media3.giphy.com/media/v1.Y2lkPTc0MTM1NmMzeWpuMTF5YnFnbDJyZWpydHJya3pscGd0YWV6dDBnbzZ1aGh6MnZqcSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/bGPTxLislwm3u/giphy.gif'
  ],
  popcorn: [
    'https://media1.giphy.com/media/v1.Y2lkPTc0MTM1NmMzNTR6ZWZ4bnBiNHZ5ZGk4Z3FlYnl4NWNtdHp0c25tbjl3aXJqb3hzMCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/pUeXcg80cO8I8/giphy.gif',
    'https://media0.giphy.com/media/v1.Y2lkPTc0MTM1NmMzNTR6ZWZ4bnBiNHZ5ZGk4Z3FlYnl4NWNtdHp0c25tbjl3aXJqb3hzMCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/tyqcJoNjNv0Fq/giphy.gif',
    'https://media4.giphy.com/media/v1.Y2lkPTc0MTM1NmMzNTR6ZWZ4bnBiNHZ5ZGk4Z3FlYnl4NWNtdHp0c25tbjl3aXJqb3hzMCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/iDJuQR0UmiqOI/giphy.gif'
  ],
  dance: [
    'https://media1.giphy.com/media/v1.Y2lkPTc0MTM1NmMzZ2F6N3lvcGV5dXh4NzFqZnh0aHJxbzkyaHNqbGNhcGF1ZnN3ejQxbiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/ujTVMASREzuRbH6zy5/giphy.gif',
    'https://media2.giphy.com/media/v1.Y2lkPTc0MTM1NmMzZ2F6N3lvcGV5dXh4NzFqZnh0aHJxbzkyaHNqbGNhcGF1ZnN3ejQxbiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/V7jkATiqn3mRie2LI2/giphy.gif',
    'https://media3.giphy.com/media/v1.Y2lkPTc0MTM1NmMzZ2F6N3lvcGV5dXh4NzFqZnh0aHJxbzkyaHNqbGNhcGF1ZnN3ejQxbiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/FbiL9rsmZN3ib2JSGo/giphy.gif'
  ],
  think: [
    'https://media2.giphy.com/media/v1.Y2lkPTc0MTM1NmMzNDBpeGgwOWdrNjd6bWZwbGxhOG1mdjRkb3g1bzFqdWQybXI3Zjh1MiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/d3mlE7uhX8KFgEmY/giphy.gif',
    'https://media0.giphy.com/media/v1.Y2lkPTc0MTM1NmMzNDBpeGgwOWdrNjd6bWZwbGxhOG1mdjRkb3g1bzFqdWQybXI3Zjh1MiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/a5viI92PAF89q/giphy.gif',
    'https://media0.giphy.com/media/v1.Y2lkPTc0MTM1NmMzNDBpeGgwOWdrNjd6bWZwbGxhOG1mdjRkb3g1bzFqdWQybXI3Zjh1MiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/777Aby0ZetYE8/giphy.gif'
  ],
  shrug: [
    'https://media2.giphy.com/media/v1.Y2lkPTc0MTM1NmMzYmV2cGhra24ybnNyZTY2NzZ1NHRpamt3NGx3Z2ZwZzk3ZTh2MHk1MyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/jPAdK8Nfzzwt2/giphy.gif',
    'https://media2.giphy.com/media/v1.Y2lkPTc0MTM1NmMzYmV2cGhra24ybnNyZTY2NzZ1NHRpamt3NGx3Z2ZwZzk3ZTh2MHk1MyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/SAHGcjT1jNvDB6oxI8/giphy.gif',
    'https://media4.giphy.com/media/v1.Y2lkPTc0MTM1NmMzYmV2cGhra24ybnNyZTY2NzZ1NHRpamt3NGx3Z2ZwZzk3ZTh2MHk1MyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/ma7VlDSlty3EA/giphy.gif'
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
    logger.info(`GifService.getGif: query="${query}" guildId="${guildId}" theme="${theme}"`)
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
          let candidates = data
          if (theme === 'anime') {
            // Filter to ensure results are anime-related by checking slug, title, or username
            candidates = data.filter(item => {
              const textToMatch = `${item.slug || ''} ${item.title || ''} ${item.username || ''}`.toLowerCase()
              return textToMatch.includes('anime') ||
                     textToMatch.includes('manga') ||
                     textToMatch.includes('chibi') ||
                     textToMatch.includes('otaku') ||
                     textToMatch.includes('waifu') ||
                     textToMatch.includes('ghibli') ||
                     textToMatch.includes('naruto') ||
                     textToMatch.includes('one piece') ||
                     textToMatch.includes('dragon ball') ||
                     textToMatch.includes('sailor moon') ||
                     textToMatch.includes('pokemon')
            })
            logger.info(`GifService: Giphy returned ${data.length} results, filtered down to ${candidates.length} anime candidates.`)
          }

          if (candidates.length > 0) {
            const randIdx = Math.floor(Math.random() * candidates.length)
            const gifUrl = candidates[randIdx].images?.original?.url
            if (gifUrl) {
              return gifUrl
            }
          } else if (theme === 'anime') {
            logger.info(`GifService: Giphy results for "${searchQuery}" contained no valid anime matches. Falling back to nekos.best.`)
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
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'SkynetBot (https://github.com/CruiseBrantley/skynet)'
          }
        })
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
