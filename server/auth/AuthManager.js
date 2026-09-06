const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const logger = require('../../logger')
const DiscordAuthProvider = require('./DiscordAuthProvider')
const TwitchAuthProvider = require('./TwitchAuthProvider')

const USERS_FILE = path.join(__dirname, '../../data/users.json')
const SESSION_COOKIE_NAME = 'skynet_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

class AuthManager {
  constructor () {
    this._providers = new Map()
    this._secret = process.env.SESSION_SECRET || process.env.TOKEN || 'skynet_default_secret_key_change_me'
    this._users = new Map()

    this._ensureDataDir()
    this._loadUsers()
    this._registerDefaultProviders()
  }

  _ensureDataDir () {
    try {
      const dataDir = path.dirname(USERS_FILE)
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true })
      }
    } catch (_) {}
  }

  _loadUsers () {
    try {
      if (fs.existsSync(USERS_FILE)) {
        const raw = fs.readFileSync(USERS_FILE, 'utf8')
        const list = JSON.parse(raw)
        if (Array.isArray(list)) {
          for (const u of list) {
            if (u.id) this._users.set(u.id, u)
          }
        }
      }
    } catch (err) {
      logger.warn(`AuthManager: Could not load ${USERS_FILE}: ${err.message}`)
    }
  }

  _saveUsers () {
    try {
      this._ensureDataDir()
      const list = Array.from(this._users.values())
      fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2), 'utf8')
    } catch (err) {
      logger.error(`AuthManager: Could not save ${USERS_FILE}: ${err.message}`)
    }
  }

  _registerDefaultProviders () {
    this.registerProvider(new DiscordAuthProvider())
    this.registerProvider(new TwitchAuthProvider())
  }

  /**
   * Registers a new authentication provider.
   * @param {import('./BaseAuthProvider')} provider
   */
  registerProvider (provider) {
    if (!provider || !provider.name) return
    this._providers.set(provider.name.toLowerCase(), provider)
    logger.info(`AuthManager: Registered auth provider "${provider.name}" (configured=${provider.isConfigured()})`)
  }

  /**
   * Returns a provider by name.
   * @param {string} name
   * @returns {import('./BaseAuthProvider')|null}
   */
  getProvider (name) {
    return this._providers.get(name?.toLowerCase()) || null
  }

  /**
   * Returns all active/configured providers for client display.
   */
  listConfiguredProviders () {
    const list = []
    for (const p of this._providers.values()) {
      if (p.isConfigured()) {
        list.push({
          name: p.name,
          displayName: p.displayName,
          icon: p.icon
        })
      }
    }
    return list
  }

  /**
   * Returns a user by their internal ID.
   * @param {string} userId
   * @returns {object|null}
   */
  getUser (userId) {
    if (!userId) return null
    return this._users.get(userId) || null
  }

  /**
   * Upserts or links an authenticated identity to an internal user record.
   */
  upsertUser (profile) {
    const { id: providerUserId, provider, username, displayName, avatar, email } = profile
    const compositeKey = `${provider}_${providerUserId}`

    // Check if this provider ID is the owner
    const isOwner = (provider === 'discord' && providerUserId === process.env.OWNER_ID)

    // Find existing user by:
    // 1. Existing identity from same provider and ID
    // 2. Matching verified email (e.g. siriancalmfrost@gmail.com on both Discord and Twitch)
    let user = Array.from(this._users.values()).find(u =>
      u.identities?.some(i => i.provider === provider && i.id === providerUserId)
    )

    if (!user && email) {
      user = Array.from(this._users.values()).find(u =>
        Boolean(u.email && u.email.toLowerCase() === email.toLowerCase())
      )
      if (user) {
        logger.info(`AuthManager: Automatically linked ${provider} account (@${username}) to user "${user.username}" via matching email ${email}`)
      }
    }

    const canonicalProfileId = isOwner
      ? 'sirian'
      : (provider === 'discord' ? `user_${providerUserId}` : `user_${compositeKey}`)

    const now = Date.now()

    if (!user) {
      user = {
        id: isOwner ? 'sirian' : (provider === 'discord' ? providerUserId : compositeKey),
        isOwner,
        profileId: canonicalProfileId,
        username: username || displayName || 'User',
        displayName: displayName || username || 'User',
        avatar: avatar || null,
        email: email || null,
        createdAt: now,
        lastLoginAt: now,
        identities: [
          {
            provider,
            id: providerUserId,
            username,
            avatar,
            email,
            linkedAt: now
          }
        ]
      }
      this._users.set(user.id, user)
    } else {
      user.lastLoginAt = now
      user.username = username || user.username
      user.displayName = displayName || user.displayName
      if (avatar) user.avatar = avatar
      if (email) user.email = email
      if (isOwner) {
        user.isOwner = true
        user.profileId = 'sirian'
      } else if (provider === 'discord' && (!user.profileId || user.profileId.startsWith('user_discord_'))) {
        user.profileId = `user_${providerUserId}`
      }

      const identityIndex = user.identities.findIndex(i => i.provider === provider && i.id === providerUserId)
      if (identityIndex >= 0) {
        user.identities[identityIndex] = { ...user.identities[identityIndex], username, avatar, email, updatedAt: now }
      } else {
        user.identities.push({ provider, id: providerUserId, username, avatar, email, linkedAt: now })
      }
    }

    this._saveUsers()
    return user
  }

  /**
   * Creates a signed session token.
   * Format: base64(payload).signature
   */
  createSessionToken (user) {
    const payload = {
      userId: user.id,
      profileId: user.profileId,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      isOwner: Boolean(user.isOwner),
      exp: Date.now() + SESSION_TTL_MS
    }

    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const sig = crypto.createHmac('sha256', this._secret).update(payloadB64).digest('base64url')
    return `${payloadB64}.${sig}`
  }

  /**
   * Verifies and decodes a session token.
   * @param {string} token
   * @returns {object|null}
   */
  verifySessionToken (token) {
    if (!token || typeof token !== 'string') return null
    const parts = token.split('.')
    if (parts.length !== 2) return null

    const [payloadB64, sig] = parts
    const expectedSig = crypto.createHmac('sha256', this._secret).update(payloadB64).digest('base64url')

    // Constant-time comparison
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return null
    }

    try {
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
      if (payload.exp && Date.now() > payload.exp) {
        return null // Expired
      }
      return payload
    } catch (_) {
      return null
    }
  }

  /**
   * Resolves session info from Express request cookies or headers.
   * @param {import('express').Request} req
   * @returns {object|null}
   */
  resolveSession (req) {
    if (!req) return null

    // 1. Bearer token in Authorization header
    const authHeader = req.headers?.authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim()
      const session = this.verifySessionToken(token)
      if (session) return session
    }

    // 2. Cookie parser or raw cookie string
    let token = req.cookies?.[SESSION_COOKIE_NAME]
    if (!token && req.headers?.cookie) {
      const match = req.headers.cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`))
      if (match) token = decodeURIComponent(match[1])
    }

    if (token) {
      return this.verifySessionToken(token)
    }

    return null
  }
}

module.exports = new AuthManager()
