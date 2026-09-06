const fs = require('fs')
const path = require('path')
const logger = require('../logger')

function getBasePrompt (options = {}) {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../config/system_prompt.txt'), 'utf8').trim()
    const AgentTurnManager = require('./chat/AgentTurnManager')
    const toolCatalog = AgentTurnManager.getToolCatalogPrompt(options)

    let prompt = toolCatalog ? `${raw}\n\n${toolCatalog}` : raw

    // Inject AGENTS.md protocol rules for bot owner sessions
    const isOwner = Boolean(options && (options.isOwner || options.userId === process.env.OWNER_ID))
    if (isOwner) {
      const agentsMdPath = path.join(__dirname, '../AGENTS.md')
      if (fs.existsSync(agentsMdPath)) {
        try {
          const agentsRules = fs.readFileSync(agentsMdPath, 'utf8').trim()
          prompt += `\n\n### AGENT WORKFLOW & VERIFICATION PROTOCOL (AGENTS.md) ###\n${agentsRules}`
        } catch (_) {}
      }
    }

    return prompt
  } catch (e) {
    logger.error(`Failed to read system_prompt.txt: ${e.message}`)
    return 'You are Skynet.'
  }
}

module.exports = { getBasePrompt }
