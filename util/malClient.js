const axios = require('axios')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const logger = require('../logger')

const DATA_DIR = path.join(__dirname, '../data')
const AUTH_FILE = path.join(DATA_DIR, 'mal_auth.json')
const MAL_AUTH_URL = 'https://myanimelist.net/v1/oauth2/authorize'
const MAL_TOKEN_URL = 'https://myanimelist.net/v1/oauth2/token'
const MAL_API_BASE = 'https://api.myanimelist.net/v2'

/**
 * Sanitize and bound search query for MyAnimeList API v2 (which rejects queries > 64 chars).
 * Preserves season suffixes if present so multi-season queries match the right cour.
 */
function sanitizeMalQuery (rawQuery) {
  if (!rawQuery) return ''
  const q = rawQuery.trim()
  if (q.length <= 64) return q

  // If > 64 chars, preserve season suffix (e.g. "Season 3", "2nd Season", "Part 2")
  const seasonMatch = q.match(/(?:(?:\d+(?:st|nd|rd|th)|second|third|fourth|final)\s+season|season\s+\d+|part\s+\d+|cour\s+\d+)/i)
  const seasonPart = seasonMatch ? ` ${seasonMatch[0]}` : ''

  const clean = q.replace(/[:;,!?"']/g, ' ').replace(/\s+/g, ' ').trim()
  const maxPrefixLen = 64 - seasonPart.length
  const prefix = clean.slice(0, maxPrefixLen).trim()

  return (prefix + seasonPart).slice(0, 64).trim()
}

class MalClient {
  constructor () {
    this.clientId = process.env.MAL_CLIENT_ID || ''
    this.clientSecret = process.env.MAL_CLIENT_SECRET || ''
    this.redirectUri = process.env.MAL_REDIRECT_URI || 'http://localhost:3000/mal/callback'
    this.username = process.env.MYANIMELIST_USERNAME || 'skynetanimelist'
    this._ensureDataDir()
  }

  _ensureDataDir () {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
  }

  _readAuth () {
    try {
      if (fs.existsSync(AUTH_FILE)) {
        return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'))
      }
    } catch (e) {
      logger.warn(`MalClient: Failed to read ${AUTH_FILE}: ${e.message}`)
    }
    return {}
  }

  _saveAuth (data) {
    try {
      this._ensureDataDir()
      const existing = this._readAuth()
      const merged = { ...existing, ...data }
      fs.writeFileSync(AUTH_FILE, JSON.stringify(merged, null, 2), 'utf8')
    } catch (e) {
      logger.error(`MalClient: Failed to write ${AUTH_FILE}: ${e.message}`)
    }
  }

  isConfigured () {
    return Boolean(process.env.MAL_CLIENT_ID && process.env.MAL_CLIENT_SECRET)
  }

  isAuthenticated () {
    const auth = this._readAuth()
    return Boolean(auth.access_token || auth.refresh_token)
  }

  generatePkce () {
    // MAL requires code_challenge_method=plain where code_challenge == code_verifier (43-128 chars)
    const verifier = crypto.randomBytes(64).toString('hex') // exactly 128 hex chars [0-9a-f]
    return { verifier, challenge: verifier }
  }

  getAuthUrl () {
    if (!this.clientId) {
      this.clientId = process.env.MAL_CLIENT_ID || ''
    }
    if (!this.clientId) {
      throw new Error('MAL_CLIENT_ID is not configured in .env')
    }

    const { verifier, challenge } = this.generatePkce()
    this._saveAuth({ pending_verifier: verifier, pending_created: Date.now() })

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      code_challenge: challenge,
      code_challenge_method: 'plain',
      redirect_uri: this.redirectUri
    })

    return `${MAL_AUTH_URL}?${params.toString()}`
  }

  async handleCallback (code) {
    const auth = this._readAuth()
    const verifier = auth.pending_verifier
    if (!verifier) {
      throw new Error('No pending PKCE code_verifier found. Please initiate login first.')
    }

    const payload = {
      client_id: this.clientId || process.env.MAL_CLIENT_ID,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri || process.env.MAL_REDIRECT_URI
    }
    const secret = this.clientSecret || process.env.MAL_CLIENT_SECRET
    if (secret) {
      payload.client_secret = secret
    }

    const params = new URLSearchParams(payload)

    let res
    try {
      res = await axios.post(MAL_TOKEN_URL, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000
      })
    } catch (err) {
      const hint = err.response?.data?.hint || err.response?.data?.message || err.message
      logger.error(`MalClient: Token exchange failed (${err.response?.status}): ${hint}`, err.response?.data)
      throw new Error(`MAL token exchange failed: ${hint}`)
    }

    const tokenData = res.data
    const now = Date.now()
    const expiresAt = now + (tokenData.expires_in * 1000)

    this._saveAuth({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      expires_at: expiresAt,
      token_type: tokenData.token_type || 'Bearer',
      pending_verifier: null
    })

    logger.info(`MalClient: Successfully authenticated MAL account. Tokens expire in ${tokenData.expires_in}s.`)
    return {
      success: true,
      expires_at: expiresAt
    }
  }

  async getValidToken () {
    const auth = this._readAuth()
    if (!auth.access_token && !auth.refresh_token) {
      throw new Error('MalClient is not authenticated. Please visit the MAL login link.')
    }

    const now = Date.now()
    const isExpired = auth.expires_at ? (now >= auth.expires_at - 300_000) : false

    if (!isExpired && auth.access_token) {
      return auth.access_token
    }

    if (!auth.refresh_token) {
      throw new Error('Access token expired and no refresh_token available.')
    }

    logger.info('MalClient: Refreshing expired access token...')
    const params = new URLSearchParams({
      client_id: this.clientId || process.env.MAL_CLIENT_ID,
      client_secret: this.clientSecret || process.env.MAL_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: auth.refresh_token
    })

    const res = await axios.post(MAL_TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    })

    const tokenData = res.data
    const newExpiresAt = Date.now() + (tokenData.expires_in * 1000)

    this._saveAuth({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || auth.refresh_token,
      expires_in: tokenData.expires_in,
      expires_at: newExpiresAt
    })

    logger.info('MalClient: Token refreshed successfully.')
    return tokenData.access_token
  }

  async searchAnime (query) {
    if (!query) return null

    try {
      const animeSync = require('./actions/anime_sync')
      const details = await animeSync.getAnimeDetails(query)
      if (details?.idMal) {
        return {
          id: details.idMal,
          title: details.title?.english || details.title?.romaji || query,
          romajiTitle: details.title?.romaji,
          episodes: details.episodes,
          coverImage: details.coverImage?.large,
          status: details.status,
          media: details
        }
      }
    } catch (_) {}

    try {
      const token = await this.getValidToken().catch(() => null)
      const headers = token
        ? { Authorization: `Bearer ${token}` }
        : { 'X-MAL-CLIENT-ID': this.clientId || process.env.MAL_CLIENT_ID }

      const malQuery = sanitizeMalQuery(query)
      const res = await axios.get(`${MAL_API_BASE}/anime`, {
        headers,
        params: { q: malQuery, limit: 10, fields: 'id,title,alternative_titles,main_picture,num_episodes,status' },
        timeout: 10000
      })

      const nodes = (res.data?.data || []).map(d => d.node).filter(Boolean)
      if (nodes.length > 0) {
        let best = nodes[0]
        const seasonMatch = query.match(/(?:(?:\d+(?:st|nd|rd|th)|second|third|fourth|final)\s+season|season\s+\d+|part\s+\d+)/i)
        if (seasonMatch) {
          const num = seasonMatch[0].match(/\d+/)?.[0]
          if (num) {
            const matched = nodes.find(n => {
              const full = `${n.title} ${n.alternative_titles?.en || ''} ${(n.alternative_titles?.synonyms || []).join(' ')}`.toLowerCase()
              return full.includes(`season ${num}`) ||
                full.includes(`${num}nd season`) ||
                full.includes(`${num}rd season`) ||
                full.includes(`${num}th season`) ||
                full.includes(`${num}st season`)
            })
            if (matched) best = matched
          }
        }

        const displayTitle = best.alternative_titles?.en || best.title
        let media = null
        try {
          const animeSync = require('./actions/anime_sync')
          media = await animeSync.getAnimeDetails(null, best.id)
        } catch (_) {}

        return {
          id: best.id,
          title: media?.title?.english || displayTitle,
          romajiTitle: media?.title?.romaji || best.title,
          episodes: media?.episodes || best.num_episodes,
          coverImage: media?.coverImage?.large || best.main_picture?.large || best.main_picture?.medium,
          status: media?.status || best.status,
          media
        }
      }
    } catch (err) {
      logger.warn(`MalClient: MAL search failed for "${query}": ${err.message}`)
    }

    return null
  }

  async addAnime (animeIdOrTitle, options = {}) {
    const token = await this.getValidToken()

    let animeId = typeof animeIdOrTitle === 'number' ? animeIdOrTitle : parseInt(animeIdOrTitle, 10)
    let animeInfo = null

    if (isNaN(animeId)) {
      animeInfo = await this.searchAnime(animeIdOrTitle)
      if (!animeInfo) {
        throw new Error(`Could not find anime matching "${animeIdOrTitle}" on MyAnimeList.`)
      }
      animeId = animeInfo.id
    }

    const status = options.status || 'watching'
    const params = new URLSearchParams({
      status
    })

    if (options.num_watched_episodes !== undefined) {
      params.append('num_watched_episodes', String(options.num_watched_episodes))
    }

    const res = await axios.put(
      `${MAL_API_BASE}/anime/${animeId}/my_list_status`,
      params.toString(),
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      }
    )

    logger.info(`MalClient: Added/updated anime ID ${animeId} on MAL list (status: ${status}).`)
    return {
      success: true,
      animeId,
      title: animeInfo?.title || `Anime ID ${animeId}`,
      coverImage: animeInfo?.coverImage,
      episodes: animeInfo?.episodes,
      media: animeInfo?.media,
      listStatus: res.data
    }
  }

  async removeAnime (animeIdOrTitle) {
    const token = await this.getValidToken()

    let animeId = typeof animeIdOrTitle === 'number' ? animeIdOrTitle : parseInt(animeIdOrTitle, 10)
    let animeInfo = null

    if (isNaN(animeId)) {
      animeInfo = await this.searchAnime(animeIdOrTitle)
      if (!animeInfo) {
        throw new Error(`Could not find anime matching "${animeIdOrTitle}" on MyAnimeList.`)
      }
      animeId = animeInfo.id
    }

    await axios.delete(
      `${MAL_API_BASE}/anime/${animeId}/my_list_status`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        },
        timeout: 10000
      }
    )

    logger.info(`MalClient: Removed anime ID ${animeId} from MAL list.`)
    return {
      success: true,
      animeId,
      title: animeInfo?.title || `Anime ID ${animeId}`
    }
  }

  async getUserList (status = 'watching') {
    const username = this.username || process.env.MYANIMELIST_USERNAME || 'skynetanimelist'

    if (this.isAuthenticated()) {
      try {
        const token = await this.getValidToken()
        const res = await axios.get(`${MAL_API_BASE}/users/@me/animelist`, {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            status,
            limit: 500,
            fields: 'list_status,num_episodes,status,start_season,alternative_titles,media_type'
          },
          timeout: 15000
        })

        const items = (res.data?.data || []).map(entry => {
          const nodeStatus = entry.node?.status
          const airingStatusCode = nodeStatus === 'currently_airing' ? 1 : (nodeStatus === 'finished_airing' ? 2 : (nodeStatus === 'not_yet_aired' ? 3 : 0))
          return {
            anime_id: entry.node.id,
            anime_title: entry.node.title,
            english_title: entry.node.alternative_titles?.en || null,
            anime_num_episodes: entry.node.num_episodes,
            airing_status: nodeStatus,
            anime_airing_status: airingStatusCode,
            status: entry.list_status?.status,
            score: entry.list_status?.score,
            episodes_watched: entry.list_status?.num_episodes_watched,
            updated_at: entry.list_status?.updated_at
          }
        })

        return items
      } catch (err) {
        logger.warn(`MalClient: Authenticated animelist fetch failed, falling back to public: ${err.message}`)
      }
    }

    const animeSync = require('./actions/anime_sync')
    const statusCode = status === 'watching' ? 1 : (status === 'completed' ? 2 : (status === 'plan_to_watch' ? 6 : 7))
    if (typeof animeSync.fetchMalList === 'function') {
      return await animeSync.fetchMalList(username, statusCode)
    }
    return []
  }

  getPublicUrl () {
    const username = this.username || process.env.MYANIMELIST_USERNAME || 'skynetanimelist'
    return `https://myanimelist.net/animelist/${username}`
  }
}

module.exports = new MalClient()
