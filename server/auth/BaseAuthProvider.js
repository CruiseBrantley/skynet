/**
 * BaseAuthProvider
 * Abstract base class for extensible OAuth2 providers in Skynet.
 */
class BaseAuthProvider {
  /**
   * @param {object} config
   * @param {string} config.name - Unique identifier (e.g., 'discord', 'twitch', 'google')
   * @param {string} config.displayName - Human-readable name (e.g., 'Discord', 'Twitch')
   * @param {string} [config.icon] - CSS/SVG or icon name for UI rendering
   */
  constructor ({ name, displayName, icon = null }) {
    if (!name || !displayName) {
      throw new Error('BaseAuthProvider: "name" and "displayName" are required.')
    }
    this.name = name
    this.displayName = displayName
    this.icon = icon
  }

  /**
   * Whether this provider is configured and available based on environment variables.
   * @returns {boolean}
   */
  isConfigured () {
    return false
  }

  /**
   * Generates the OAuth2 authorization URL to redirect the user to.
   * @param {string} state - Random CSRF state token
   * @param {string} redirectUri - Standardized callback URL
   * @returns {string} Full authorization URL
   */
  getAuthorizationUrl (state, redirectUri) {
    throw new Error(`getAuthorizationUrl() must be implemented by ${this.constructor.name}`)
  }

  /**
   * Exchanges authorization code for tokens and fetches the user profile.
   * @param {string} code - OAuth2 authorization code
   * @param {string} redirectUri - Standardized callback URL
   * @returns {Promise<{ id: string, provider: string, username: string, displayName: string, avatar: string|null, email: string|null, raw: object }>}
   */
  async handleCallback (code, redirectUri) {
    throw new Error(`handleCallback() must be implemented by ${this.constructor.name}`)
  }
}

module.exports = BaseAuthProvider
