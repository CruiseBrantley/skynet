const fs = require('fs')
const path = require('path')
const logger = require('../logger')

class MentionResolver {
  constructor () {
    this.filePath = path.join(__dirname, '../data/mentions.json')
    this.mentionMap = {} // { guildId: { name: id } }
    this.load()
  }

  load () {
    try {
      if (fs.existsSync(this.filePath)) {
        this.mentionMap = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      }
    } catch (e) {
      logger.error(`Failed to load mentions.json: ${e.message}`)
    }
  }

  save () {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.mentionMap, null, 2))
    } catch (e) {
      logger.error(`Failed to save mentions.json: ${e.message}`)
    }
  }

  /**
     * Records a username/nickname to ID mapping for a specific guild.
     * @param {string} name
     * @param {string} id
     * @param {string} guildId
     */
  record (name, id, guildId) {
    if (!name || !id || !guildId) return
    if (!this.mentionMap[guildId]) this.mentionMap[guildId] = {}

    const lowerName = name.toLowerCase()
    if (this.mentionMap[guildId][lowerName] !== id) {
      this.mentionMap[guildId][lowerName] = id
      this.save()
    }
  }

  /**
     * Resolves all @usernames in the text to Discord mentions using the stored map for a guild.
     * @param {string} text
     * @param {string} guildId
     * @returns {string} resolved text
     */
  resolve (text, guildId) {
    if (!text || !guildId || !this.mentionMap[guildId]) return text
    let resolved = text

    // Sort keys by length descending to prevent partial matches
    const names = Object.keys(this.mentionMap[guildId]).sort((a, b) => b.length - a.length)

    for (const name of names) {
      const id = this.mentionMap[guildId][name]
      const regex = new RegExp(`@${name}(?![\\w])`, 'gi')
      resolved = resolved.replace(regex, `<@${id}>`)
    }
    return resolved
  }
}

module.exports = new MentionResolver()
