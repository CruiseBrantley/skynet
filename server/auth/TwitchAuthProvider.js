const axios = require('axios')
const BaseAuthProvider = require('./BaseAuthProvider')
const logger = require('../../logger')

class TwitchAuthProvider extends BaseAuthProvider {
  constructor () {
    super({
      name: 'twitch',
      displayName: 'Twitch',
      icon: 'twitch'
    })
  }

  isConfigured () {
    const clientId = process.env.TWITCH_CLIENTID
    const clientSecret = process.env.TWITCH_SECRET
    return Boolean(clientId && clientSecret)
  }

  getAuthorizationUrl (state, redirectUri) {
    const clientId = process.env.TWITCH_CLIENTID
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'user:read:email',
      state: state || 'skynet_auth',
      force_verify: 'false'
    })
    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`
  }

  async handleCallback (code, redirectUri) {
    const clientId = process.env.TWITCH_CLIENTID
    const clientSecret = process.env.TWITCH_SECRET

    if (!clientId || !clientSecret) {
      throw new Error('Twitch OAuth is missing TWITCH_CLIENTID or TWITCH_SECRET.')
    }

    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    })

    const tokenRes = await axios.post('https://id.twitch.tv/oauth2/token', tokenParams.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })

    const accessToken = tokenRes.data.access_token
    if (!accessToken) {
      throw new Error('Failed to retrieve access token from Twitch.')
    }

    const userRes = await axios.get('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': clientId
      }
    })

    const user = userRes.data?.data?.[0]
    if (!user) {
      throw new Error('Failed to fetch Twitch user profile.')
    }

    logger.info(`TwitchAuthProvider: Authenticated Twitch user @${user.login} (${user.id})`)

    return {
      id: user.id,
      provider: 'twitch',
      username: user.login,
      displayName: user.display_name || user.login,
      avatar: user.profile_image_url || null,
      email: user.email || null,
      raw: user
    }
  }
}

module.exports = TwitchAuthProvider
