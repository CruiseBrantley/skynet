const axios = require('axios')
const fs = require('fs')
const path = require('path')
const getOAuthToken = require('../../server/oauth')
const logger = require('../../logger')

const CONFIG_PATH = path.join(__dirname, '../../config/announcements.json')

function loadConfig () {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    }
  } catch (_) {}
  return { groups: [], socials: {} }
}

module.exports = {
  name: 'get_twitch_status',
  description: 'Queries live Twitch stream status for a specific streamer or all subscribed community streamers (title, game category, live viewer count).',
  schema: {
    username: {
      type: 'string',
      description: 'Twitch username (e.g. "fireraven", "shroud") or "all" to check all subscribed streamers in announcements.json.'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const target = (params.username || 'all').toLowerCase().trim().replace(/^@/, '')
    const clientId = process.env.TWITCH_CLIENTID

    let token = null
    try {
      token = await getOAuthToken()
    } catch (err) {
      return `[SYSTEM: Failed to authenticate with Twitch API: ${err.message}]`
    }

    if (!clientId || !token) {
      return '[SYSTEM: Error: TWITCH_CLIENTID or OAuth token is missing in configuration.]'
    }

    try {
      if (target && target !== 'all') {
        const res = await axios.get('https://api.twitch.tv/helix/streams', {
          headers: {
            'Client-ID': clientId,
            Authorization: `Bearer ${token}`
          },
          params: { user_login: target }
        })

        const stream = res.data?.data?.[0]
        if (stream) {
          const startedAt = new Date(stream.started_at).toLocaleTimeString()
          return `[SYSTEM: Twitch Streamer "${stream.user_name}" is currently 🔴 LIVE!\n• Game/Category: **${stream.game_name || 'Just Chatting'}**\n• Title: "${stream.title}"\n• Viewers: ${stream.viewer_count.toLocaleString()}\n• Started: ${startedAt}\n• Stream URL: https://twitch.tv/${stream.user_login}]`
        }

        return `[SYSTEM: Twitch Streamer "${target}" is currently ⚪ Offline.]`
      }

      // Check all subscribed streamers from announcements.json
      const config = loadConfig()
      const allLogins = []
      if (config && config.socials) {
        for (const [login] of Object.entries(config.socials)) {
          allLogins.push(login.toLowerCase())
        }
      }

      if (allLogins.length === 0) {
        return '[SYSTEM: No subscribed Twitch streamers found in config/announcements.json.]'
      }

      // Batch query up to 100 streamers at once
      const params = new URLSearchParams()
      for (const login of allLogins.slice(0, 100)) {
        params.append('user_login', login)
      }

      const res = await axios.get(`https://api.twitch.tv/helix/streams?${params.toString()}`, {
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${token}`
        }
      })

      const liveStreams = res.data?.data || []
      const liveLogins = new Set(liveStreams.map(s => s.user_login.toLowerCase()))
      const offlineLogins = allLogins.filter(l => !liveLogins.has(l))

      let out = `🎮 **Twitch Community Stream Status (${liveStreams.length} Live / ${allLogins.length} Total)**:\n\n`

      if (liveStreams.length > 0) {
        out += '**🔴 Currently Live:**\n'
        for (const s of liveStreams) {
          out += `• **[${s.user_name}](https://twitch.tv/${s.user_login})** playing **${s.game_name || 'Just Chatting'}** (${s.viewer_count.toLocaleString()} viewers)\n  ↳ *"${s.title}"*\n`
        }
        out += '\n'
      }

      out += `**⚪ Offline (${offlineLogins.length}):** ${offlineLogins.map(l => `\`${l}\``).join(', ')}`

      return `[SYSTEM: Live Twitch Status Feed:\n${out}]`
    } catch (err) {
      logger.error(`get_twitch_status: Error querying Twitch API: ${err.message}`)
      return `[SYSTEM: Error querying Twitch API: ${err.message}]`
    }
  }
}
