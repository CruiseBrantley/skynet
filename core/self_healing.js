const fs = require('fs')
const path = require('path')
const logger = require('../logger')
const { jsonrepair } = require('jsonrepair')
const ollama = require('../util/ollama')

const DATA_DIR = path.join(__dirname, '../data')
const PROPOSALS_FILE = path.join(DATA_DIR, 'pending_repairs.json')
const BACKUPS_DIR = path.join(DATA_DIR, 'command_backups')
const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000

class CoreSelfHealing {
  constructor ({ actionExecutor, agentMemory } = {}) {
    this.actionExecutor = actionExecutor || require('../util/ActionExecutor')
    this.agentMemory = agentMemory || require('./memory')
    this.pendingProposals = new Map()
    this._loadProposals()
  }

  _loadProposals () {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
      }
      if (fs.existsSync(PROPOSALS_FILE)) {
        const raw = fs.readFileSync(PROPOSALS_FILE, 'utf8')
        const parsed = JSON.parse(raw)
        const now = Date.now()
        this.pendingProposals.clear()

        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.proposalId && item.timestamp && (now - item.timestamp) < PROPOSAL_TTL_MS) {
              this.pendingProposals.set(item.proposalId, item)
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`SelfHealingEngine: Could not load pending repairs: ${err.message}`)
      this.pendingProposals.clear()
    }
  }

  _saveProposals () {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
      }
      const array = Array.from(this.pendingProposals.values())
      fs.writeFileSync(PROPOSALS_FILE, JSON.stringify(array, null, 2), 'utf8')
    } catch (err) {
      logger.warn(`SelfHealingEngine: Could not save pending repairs: ${err.message}`)
    }
  }

  createBackup (targetType, name) {
    try {
      if (!fs.existsSync(BACKUPS_DIR)) {
        fs.mkdirSync(BACKUPS_DIR, { recursive: true })
      }

      let sourcePath = null
      if (targetType === 'slash') {
        sourcePath = path.join(__dirname, '../commands', `${name}.js`)
      } else if (targetType === 'action') {
        sourcePath = path.join(__dirname, '../data/agent_actions', `${name}.js`)
      }

      if (sourcePath && fs.existsSync(sourcePath)) {
        const backupId = `bak_${targetType}_${name}_${Date.now()}`
        const backupPath = path.join(BACKUPS_DIR, `${backupId}.bak.js`)
        fs.copyFileSync(sourcePath, backupPath)
        logger.info(`SelfHealingEngine: Created backup snapshot for ${targetType} "${name}" at ${backupId}`)
        return backupId
      }
    } catch (err) {
      logger.warn(`SelfHealingEngine: Could not create backup snapshot: ${err.message}`)
    }
    return null
  }

  generateProposalId (name) {
    return `repair_${name.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`
  }

  async formulateRepairCode ({ targetName, targetType, currentCode, error, schema }) {
    const errorTrace = error ? (error.stack || error.message || String(error)) : 'Unknown runtime failure'

    const systemPrompt = 'You are an autonomous code repair assistant. Analyze the runtime error for the JavaScript module and provide a complete, working, corrected replacement file. Your output MUST be a single valid JSON object matching this schema:\n' +
      '{\n  "reasoning": "A concise explanation of the root cause and the fix applied",\n  "fixed_code": "The complete replacement JavaScript source code"\n}'

    const userPrompt = `Target: ${targetType} command "${targetName}"\n` +
      `Runtime Error:\n${errorTrace}\n\n` +
      (schema ? `Parameter Schema:\n${JSON.stringify(schema, null, 2)}\n\n` : '') +
      `Current Source Code:\n\`\`\`javascript\n${currentCode}\n\`\`\``

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]

    try {
      const response = await ollama.queryCodeCapableModel(messages, { isCodeTask: true })
      const rawContent = response?.message?.content || ''
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/)

      if (jsonMatch) {
        const repaired = jsonrepair(jsonMatch[0])
        const parsed = JSON.parse(repaired)
        if (parsed.fixed_code && typeof parsed.fixed_code === 'string') {
          return {
            reasoning: parsed.reasoning || 'Code repair formulated.',
            fixedCode: parsed.fixed_code.replace(/^```(javascript|js)?\n?/i, '').replace(/\n?```$/i, '').trim()
          }
        }
      }
    } catch (err) {
      logger.error(`SelfHealingEngine: Repair code formulation failed: ${err.message}`)
    }

    return null
  }

  applyFileFix (targetType, name, code) {
    let targetPath = null
    if (targetType === 'slash') {
      targetPath = path.join(__dirname, '../commands', `${name}.js`)
    } else if (targetType === 'action') {
      targetPath = path.join(__dirname, '../data/agent_actions', `${name}.js`)
    }

    if (!targetPath) {
      throw new Error(`Unknown target type "${targetType}" for file fix.`)
    }

    fs.writeFileSync(targetPath, code, 'utf8')
    logger.info(`SelfHealingEngine: Successfully wrote repaired code to ${targetPath}`)
    return targetPath
  }

  getProposal (proposalId) {
    this._loadProposals()
    return this.pendingProposals.get(proposalId) || null
  }

  saveProposal (proposal) {
    this.pendingProposals.set(proposal.proposalId, proposal)
    this._saveProposals()
  }

  deleteProposal (proposalId) {
    const deleted = this.pendingProposals.delete(proposalId)
    if (deleted) this._saveProposals()
    return deleted
  }
}

module.exports = new CoreSelfHealing()
