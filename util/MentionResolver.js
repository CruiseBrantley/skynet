const fs = require('fs')
const path = require('path')
const logger = require('../logger')

class MentionResolver {
  constructor () {
    this.filePath = path.join(__dirname, '../data/mentions.json')
    this.mentionMap = new Map()
    this.load()
  }

  load () {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
        for (const [name, id] of Object.entries(data)) {
          this.mentionMap.set(name.toLowerCase(), id)
        }
      }
    } catch (e) {
      logger.error(`Failed to load mentions.json: ${e.message}`)
    }
  }

  save () {
    try {
      const data = Object.fromEntries(this.mentionMap)
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2))
    } catch (e) {
      logger.error(`Failed to save mentions.json: ${e.message}`)
    }
  }

  /**
     * Records a username/nickname to ID mapping.
     * @param {string} name
     * @param {string} id
     */
  record (name, id) {
    if (!name || !id) return
    const lowerName = name.toLowerCase()
    if (this.mentionMap.get(lowerName) !== id) {
      this.mentionMap.set(lowerName, id)
      this.save()
    }
  }

  /**
     * Resolves all @usernames in the text to Discord mentions using the stored map.
     * @param {string} text
     * @returns {string} resolved text
     */
  resolve (text) {
    if (!text) return text
    let resolved = text

    // Sort keys by length descending to prevent partial matches
    // (e.g. "@bot" replacing "@bot_admin")
    const names = Array.from(this.mentionMap.keys()).sort((a, b) => b.length - a.length)

    for (const name of names) {
      const id = this.mentionMap.get(name)
      // Match @name followed by a non-word character or end of string
      const regex = new RegExp(`@${name}(?![\\w])`, 'gi')
      resolved = resolved.replace(regex, `<@${id}>`)
    }
    return resolved
  }
}

module.exports = new MentionResolver()
