const axios = require('axios')
const BaseAuthProvider = require('./BaseAuthProvider')
const logger = require('../../logger')

class DiscordAuthProvider extends BaseAuthProvider {
  constructor () {
    super({
      name: 'discord',
      displayName: 'Discord',
      icon: 'discord'
    })
  }

  isConfigured () {
    const clientId = process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID
    const clientSecret = process.env.DISCORD_CLIENT_SECRET
    return Boolean(clientId && clientSecret)
  }

  getAuthorizationUrl (state, redirectUri) {
    const clientId = process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify email',
      state: state || 'skynet_auth',
      prompt: 'consent'
    })
    return `https://discord.com/api/oauth2/authorize?${params.toString()}`
  }

  async handleCallback (code, redirectUri) {
    const clientId = process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID
    const clientSecret = process.env.DISCORD_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      throw new Error('Discord OAuth is missing CLIENT_ID or DISCORD_CLIENT_SECRET.')
    }

    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    })

    const tokenRes = await axios.post('https://discord.com/api/oauth2/token', tokenParams.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })

    const accessToken = tokenRes.data.access_token
    if (!accessToken) {
      throw new Error('Failed to retrieve access token from Discord.')
    }

    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })

    const user = userRes.data
    logger.info(`DiscordAuthProvider: Authenticated user @${user.username} (${user.id})`)

    let avatarUrl = null
    if (user.avatar) {
      const ext = user.avatar.startsWith('a_') ? 'gif' : 'png'
      avatarUrl = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}`
    }

    return {
      id: user.id,
      provider: 'discord',
      username: user.username,
      displayName: user.global_name || user.username,
      avatar: avatarUrl,
      email: user.email || null,
      raw: user
    }
  }
}

module.exports = DiscordAuthProvider
