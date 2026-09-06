/**
 * Base interface / contract for all Skynet client adapters (Discord, CLI, Web, Telegram, etc.)
 */
class IClientAdapter {
  constructor ({ id, name, capabilities = [] } = {}) {
    if (!id) throw new Error('IClientAdapter: "id" is required (e.g. "discord", "cli", "web").')
    this.id = id
    this.name = name || id
    this.capabilities = new Set(capabilities)
    this.core = null
  }

  /**
   * Called when SkynetCore initializes the adapter.
   * @param {import('../core/SkynetCore')} core - Central Skynet engine instance.
   */
  async start (core) {
    this.core = core
  }

  /**
   * Called when SkynetCore shuts down or unloads the adapter.
   */
  async stop () {
    this.core = null
  }

  /**
   * Checks if this adapter supports a given capability flag.
   * @param {string} capability - e.g. 'embeds', 'buttons', 'voice', 'reactions'
   * @returns {boolean}
   */
  hasCapability (capability) {
    return this.capabilities.has(capability)
  }

  /**
   * Formats and delivers an outbound message to a target session / channel.
   * @param {string} sessionId - e.g. channel ID or session token.
   * @param {object|string} payload - Text, embed structure, or rich visual components.
   * @returns {Promise<any>}
   */
  async sendMessage (sessionId, payload) {
    throw new Error(`IClientAdapter [${this.id}]: sendMessage() not implemented.`)
  }

  /**
   * Adds a reaction emoji to a specific message in a session.
   * @param {string} sessionId
   * @param {string} messageId
   * @param {string} emoji
   * @returns {Promise<void>}
   */
  async addReaction (sessionId, messageId, emoji) {
    throw new Error(`IClientAdapter [${this.id}]: addReaction() not implemented.`)
  }

  /**
   * Retrieves recent normalized messages for a session (for LLM context).
   * @param {string} sessionId
   * @param {number} limit
   * @returns {Promise<Array<{ author: string, content: string, createdTimestamp: number }>>}
   */
  async getRecentHistory (sessionId, limit = 20) {
    return []
  }

  /**
   * Returns a list of active sessions / channels for proactive agent evaluation.
   * @returns {Promise<Array<{ id: string, name: string, guildId?: string, isDM?: boolean }>>}
   */
  async getActiveSessions () {
    return []
  }
}

module.exports = IClientAdapter
