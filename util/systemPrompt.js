const fs = require('fs')
const path = require('path')
const logger = require('../logger')

function getBasePrompt () {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../config/system_prompt.txt'), 'utf8').trim()
    const AgentTurnManager = require('./chat/AgentTurnManager')
    const toolCatalog = AgentTurnManager.getToolCatalogPrompt()
    return toolCatalog ? `${raw}\n\n${toolCatalog}` : raw
  } catch (e) {
    logger.error(`Failed to read system_prompt.txt: ${e.message}`)
    return 'You are Skynet.'
  }
}

module.exports = { getBasePrompt }
