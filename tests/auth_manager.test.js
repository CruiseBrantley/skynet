require('dotenv').config()
const authManager = require('../server/auth/AuthManager')
const BaseAuthProvider = require('../server/auth/BaseAuthProvider')

describe('AuthManager & Modular OAuth System', () => {
  test('lists registered and configured providers', () => {
    const providers = authManager.listConfiguredProviders()
    expect(Array.isArray(providers)).toBe(true)
    // Twitch is configured from .env
    const twitch = providers.find(p => p.name === 'twitch')
    expect(twitch).toBeDefined()
    expect(twitch.displayName).toBe('Twitch')
  })

  test('allows registering custom OAuth providers dynamically', () => {
    class MockGoogleProvider extends BaseAuthProvider {
      constructor () {
        super({ name: 'google', displayName: 'Google', icon: 'google' })
      }
      isConfigured () { return true }
      getAuthorizationUrl (state, redirectUri) { return `https://accounts.google.com/o/oauth2/auth?state=${state}` }
      async handleCallback (code, redirectUri) {
        return {
          id: 'google_123',
          provider: 'google',
          username: 'tester',
          displayName: 'Google Tester',
          avatar: null,
          email: 'test@example.com'
        }
      }
    }

    authManager.registerProvider(new MockGoogleProvider())
    const google = authManager.getProvider('google')
    expect(google).toBeDefined()
    expect(google.displayName).toBe('Google')
    expect(google.getAuthorizationUrl('xyz', 'http://localhost')).toContain('https://accounts.google.com')
  })

  test('upserts non-owner profile and creates HMAC session token', () => {
    const user = authManager.upsertUser({
      id: '999888777',
      provider: 'discord',
      username: 'johndoe',
      displayName: 'John Doe',
      avatar: 'https://example.com/avatar.png',
      email: 'john@example.com'
    })

    expect(user.isOwner).toBe(false)
    expect(user.profileId).toBe('user_999888777')

    const token = authManager.createSessionToken(user)
    expect(typeof token).toBe('string')
    expect(token.split('.').length).toBe(2)

    const session = authManager.verifySessionToken(token)
    expect(session).toBeDefined()
    expect(session.userId).toBe('999888777')
    expect(session.profileId).toBe('user_999888777')
    expect(session.username).toBe('johndoe')
    expect(session.isOwner).toBe(false)

    // Verify getUser retrieves the user
    const fetchedUser = authManager.getUser(session.userId)
    expect(fetchedUser).toBeDefined()
    expect(fetchedUser.id).toBe('999888777')
    expect(fetchedUser.username).toBe('johndoe')
  })

  test('upserts owner profile correctly mapped to sirian', () => {
    const ownerDiscordId = process.env.OWNER_ID || '199749017150816256'
    const ownerUser = authManager.upsertUser({
      id: ownerDiscordId,
      provider: 'discord',
      username: 'Cruise',
      displayName: 'Sirian',
      avatar: 'https://example.com/cruise.png',
      email: 'cruise@example.com'
    })

    expect(ownerUser.isOwner).toBe(true)
    expect(ownerUser.profileId).toBe('sirian')

    const token = authManager.createSessionToken(ownerUser)
    const session = authManager.verifySessionToken(token)
    expect(session.isOwner).toBe(true)
    expect(session.profileId).toBe('sirian')
  })

  test('rejects tampered session tokens', () => {
    const user = { id: 'fake', profileId: 'fake', username: 'fake', isOwner: false }
    const validToken = authManager.createSessionToken(user)
    const [payloadB64, sig] = validToken.split('.')

    // Tamper payload to claim owner
    const tamperedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payloadB64, 'base64url').toString()), isOwner: true })).toString('base64url')
    const tamperedToken = `${tamperedPayload}.${sig}`

    const result = authManager.verifySessionToken(tamperedToken)
    expect(result).toBeNull()
  })
})
