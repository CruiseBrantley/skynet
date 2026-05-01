const fs = require('fs')
const path = require('path')
const youtubeSearch = require('youtube-search')
const ytpl = require('ytpl')
const logger = require('../logger')

const CACHE_FILE = path.join(__dirname, '../metadata_cache.json')

/**
 * Unified wrapper for YouTube metadata and search results.
 * Implements a persistent cache to reduce API calls and speed up response times.
 */
class YouTubeMetadata {
  constructor () {
    /** @type {Map<string, object>} */
    this.cache = new Map()

    this.searchOptions = {
      maxResults: 5,
      key: process.env.YOUTUBE_KEY,
      type: 'video'
    }

    this._loadCache()
  }

  _loadCache () {
    if (fs.existsSync(CACHE_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
        this.cache = new Map(Object.entries(data))
        logger.info(`Loaded ${this.cache.size} entries from metadata cache.`)
      } catch (err) {
        logger.warn(`Failed to load metadata cache: ${err.message}`)
      }
    }
  }

  _saveCache () {
    try {
      const data = Object.fromEntries(this.cache)
      fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2))
    } catch (err) {
      logger.warn(`Failed to save metadata cache: ${err.message}`)
    }
  }

  /**
     * Store loudness normalization stats for a video.
     */
  setLoudnormStats (videoId, stats) {
    if (!videoId) return
    const info = this.cache.get(videoId) || {}
    this._updateCache(videoId, { ...info, loudnorm: stats })
  }

  /**
     * Cache a video's metadata and trigger a persistent save.
     */
  _updateCache (videoId, info) {
    // Protect durationSeconds from being overwritten by null/undefined if we already have it
    const existing = this.cache.get(videoId)
    if (existing && existing.durationSeconds && !info.durationSeconds) {
      info.durationSeconds = existing.durationSeconds
    }

    this.cache.set(videoId, info)
    this._saveCache()
  }

  /**
     * Utility to select the best available thumbnail or upgrade to HD.
     */
  _getBestThumbnail (thumbnails) {
    if (!thumbnails) return null

    // Priority waterfall: maxres -> standard -> high -> medium -> default
    const url = thumbnails.maxres?.url ||
                 thumbnails.standard?.url ||
                 thumbnails.high?.url ||
                 thumbnails.medium?.url ||
                 thumbnails.default?.url

    if (!url) return null

    // If we only have medium, low, or numbered frames (0.jpg-3.jpg) from a search result, try to force-upgrade to hqdefault.
    // hqdefault.jpg exists for almost every video ever uploaded to YouTube and is safe.
    // maxresdefault.jpg (1080p) is only available for newer/high-res videos and often 404s on older content.
    if (url.includes('ytimg.com') && !url.includes('maxresdefault') && !url.includes('hqdefault') && !url.includes('sddefault')) {
      // Replace the low-res filename with the safe hqdefault bypass
      return url.replace(/\/(default|mqdefault|[0-3])\.jpg(\?.*)?$/, '/hqdefault.jpg')
    }

    return url
  }

  /**
     * Search YouTube and return the top N results.
     */
  async search (query, maxResults = 5) {
    if (!process.env.YOUTUBE_KEY) {
      throw new Error('YOUTUBE_KEY is missing from environment variables.')
    }

    const options = { ...this.searchOptions, maxResults }

    return new Promise((resolve, reject) => {
      youtubeSearch(query, options, (err, results) => {
        if (err) return reject(err)
        const processed = (results || []).map(r => ({
          url: r.link,
          title: r.title,
          channel: r.channelTitle,
          thumbnail: this._getBestThumbnail(r.thumbnails)
        }))
        resolve(processed)
      })
    })
  }

  /**
     * Expand a YouTube playlist URL into a list of track objects.
     */
  async expandPlaylist (url) {
    try {
      const playlist = await ytpl(url, { pages: 1 })
      return {
        title: playlist.title,
        tracks: playlist.items.map(item => ({
          url: item.shortUrl || item.url,
          title: item.title,
          channel: item.author?.name || 'Unknown',
          thumbnail: this._getBestThumbnail({
            default: { url: item.thumbnail },
            high: { url: item.bestThumbnail?.url }
          })
        }))
      }
    } catch (err) {
      // Fallback for Mixes or other unsupported dynamic playlists using yt-dlp
      logger.warn(`Could not expand playlist ${url} with ytpl, falling back to yt-dlp: ${err.message}`)

      try {
        const { execFile } = require('child_process')
        const { YT_DLP } = require('./paths')

        const ytData = await new Promise((resolve, reject) => {
          execFile(YT_DLP, ['--flat-playlist', '-J', url], { maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
            if (error) return reject(error)
            try {
              resolve(JSON.parse(stdout))
            } catch (e) {
              reject(e)
            }
          })
        })

        if (ytData && ytData.entries && ytData.entries.length > 0) {
          logger.info(`yt-dlp successfully parsed playlist with ${ytData.entries.length} tracks.`)
          return {
            title: ytData.title || 'YouTube Mix',
            tracks: ytData.entries.map(item => ({
              url: item.url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : null),
              title: item.title,
              channel: item.uploader || item.channel || 'Unknown',
              thumbnail: this._getBestThumbnail({
                default: { url: item.thumbnail },
                high: { url: item.thumbnails?.[0]?.url }
              }),
              durationSeconds: item.duration || null
            }))
          }
        }
      } catch (fallbackErr) {
        logger.warn(`yt-dlp playlist fallback also failed: ${fallbackErr.message}`)
      }

      // Ultimate fallback to single video
      const videoId = this.extractVideoId(url)
      if (videoId) {
        const info = await this.getVideoInfo(url)
        return {
          title: info.title || 'YouTube Mix Video',
          tracks: [{
            url,
            title: info.title,
            channel: info.channel,
            thumbnail: info.thumbnail,
            durationSeconds: info.durationSeconds
          }]
        }
      }
      throw err
    }
  }

  /**
     * Get metadata for a single video. Uses cache if available.
     */
  async getVideoInfo (url) {
    const videoId = this.extractVideoId(url)
    if (!videoId) return { url, title: url }

    if (this.cache.has(videoId)) {
      logger.info(`Metadata cache hit for ${videoId}`)
      return { ...this.cache.get(videoId), url }
    }

    if (!process.env.YOUTUBE_KEY) {
      return { url, title: url }
    }

    try {
      const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${process.env.YOUTUBE_KEY}`
      const res = await fetch(apiUrl)
      const data = await res.json()
      const item = data.items?.[0]

      if (!item) return { url, title: url }

      const info = {
        title: item.snippet.title || url,
        channel: item.snippet.channelTitle || null,
        thumbnail: this._getBestThumbnail(item.snippet.thumbnails),
        durationSeconds: this._parseISO8601Duration(item.contentDetails?.duration) || null
      }

      this._updateCache(videoId, info)
      return { ...info, url }
    } catch (err) {
      logger.warn(`getVideoInfo failed for ${videoId}: ${err.message}`)
      return { url, title: url }
    }
  }

  /**
     * Get a recommended song based on the last played track.
     * Uses an LLM to generate a highly intelligent, genre-aware recommendation.
     */
  async getRecommendation (historyTracks, sessionHistory = new Set()) {
    if (!historyTracks || historyTracks.length === 0) return []

    const currentTrack = historyTracks[historyTracks.length - 1]

    // Deep context for deduplication and full history awareness in the LLM
    const pastTracks = historyTracks.slice(0, -1)

    // Pre-calculate deduplication tokens for all tracks in history
    const noiseWords = new Set(['official', 'video', 'audio', 'lyrics', 'lyric', 'hd', 'hq', 'remastered', 'remix', 'ft', 'feat', 'feature', 'featuring', 'movie', 'soundtrack', 'ost', 'theme', '4k', 'mv', 'music', 'live', 'concert', 'performance', 'version', 'extended', 'edit'])
    const pastTokenSets = historyTracks.map(t => {
      const clean = t.title.toLowerCase().replace(/[^\w\s]/gi, ' ').replace(/\s+/g, ' ')
      return new Set(clean.split(' ').filter(w => w.length >= 2 && !noiseWords.has(w)))
    })

    try {
      const { queryOllama } = require('./ollama')

      // Format history for the prompt
      const historyList = pastTracks.map(t => ` - ${t.title} (${t.channel})`).join('\n')
      const currentDesc = `${currentTrack.title} (${currentTrack.channel})`

      const seed = Math.floor(Math.random() * 1000000)
      logger.info(`Getting AI recommendation based on history of ${historyTracks.length} tracks (Current: ${currentTrack.title})...`)

      const prompt = `You are an expert DJ AI. 
The user recently listened to:
${historyList || ' (No previous history)'}

They are NOW listening to:
 - ${currentDesc}

Recommend a list of 5 highly similar, great songs that fit the exact same mood, genre, and vibe as this sequence.
CRITICAL INSTRUCTIONS:
- The recommendations MUST be firmly within the exact same musical genre and vibe as the current song.
- Pick DIFFERENT tracks than any of those explicitly listed above.
- Reply with ONLY the list of 5 songs in this format: "Artist - Title", one per line. Do NOT include numbering, formatting, or explanations.`

      let aiSuggestions = []
      try {
        const dynamicTemp = Math.min(1.2, 0.7 + (historyTracks.length * 0.02))
        const result = await queryOllama('/api/generate', {
          prompt,
          options: { temperature: dynamicTemp, seed }
        })
        const rawResponse = result?.response || ''
        aiSuggestions = rawResponse.trim().split('\n').map(s => s.replace(/["']/g, '').trim()).filter(s => s.length > 0)
        logger.info(`AI suggested ${aiSuggestions.length} candidates.`)
      } catch (llmErr) {
        logger.warn(`AI recommendation failed, falling back to basic YouTube search: ${llmErr.message}`)
        aiSuggestions = [`related songs to ${currentTrack.title}`]
      }

      const finalRecommendations = []

      // Process each suggestion and aggregate unique results
      for (const suggestion of aiSuggestions.slice(0, 5)) {
        const results = await this.search(`${suggestion} official audio`, 3)

        // 1. Filter out videos that we have already played in this session
        const unplayed = results.filter(r => {
          const vidId = this.extractVideoId(r.url)
          return vidId && !sessionHistory.has(vidId)
        })

        // 2. High-Efficiency Semantic Deduplication against deep history
        const distinctUnplayed = unplayed.filter(r => {
          const clean = r.title.toLowerCase().replace(/[^\w\s]/gi, ' ').replace(/\s+/g, ' ')
          const rTokens = clean.split(' ').filter(w => w.length >= 2 && !noiseWords.has(w))
          if (rTokens.length === 0) return true

          const rSet = new Set(rTokens)
          return !pastTokenSets.some(pastSet => {
            if (pastSet.size === 0) return false
            let overlap = 0
            for (const word of rSet) {
              if (pastSet.has(word)) overlap++
            }
            const threshold = Math.max(2, rSet.size * 0.5)
            return overlap >= threshold
          })
        })

        if (distinctUnplayed.length > 0) {
          // Avoid adding the same video ID twice if multiple AI suggestions lead to the same result
          const candidate = distinctUnplayed[0]
          const candId = this.extractVideoId(candidate.url)
          if (!finalRecommendations.some(ext => this.extractVideoId(ext.url) === candId)) {
            finalRecommendations.push(candidate)
          }
        }
      }

      return finalRecommendations
    } catch (err) {
      const trackTitle = currentTrack?.title || 'unknown track'
      logger.warn(`Failed to get recommendation for ${trackTitle}: ${err.message}`)
      return []
    }
  }

  /**
     * Helper to extract video ID from various YouTube URL formats.
     */
  extractVideoId (url) {
    const patterns = [
      /[?&]v=([a-zA-Z0-9_-]{11})/,
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,
      /\/shorts\/([a-zA-Z0-9_-]{11})/
    ]
    for (const p of patterns) {
      const m = url.match(p)
      if (m) return m[1]
    }
    return null
  }

  /**
     * Detect if a string is a YouTube URL.
     */
  isYouTubeURL (str) {
    return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(str)
  }

  /**
     * Detect if a YouTube URL is a playlist.
     */
  isPlaylistURL (str) {
    return /[?&]list=/i.test(str)
  }

  _parseISO8601Duration (iso) {
    if (!iso) return null
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
    if (!m) return null
    return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0)
  }
}

// Singleton
module.exports = new YouTubeMetadata()
