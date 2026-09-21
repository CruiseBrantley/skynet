const fs = require('fs')
const path = require('path')
const logger = require('../logger')
const stateStore = require('./state')

const DATA_DIR = path.join(__dirname, '../data')
const WORKFLOWS_FILE = path.join(DATA_DIR, 'agent_workflows.json')

class WorkflowEngine {
  constructor () {
    this._workflows = []
    this._database = null
    this._syncTimer = null
    this._ensureDataDir()
    this._load()
  }

  _ensureDataDir () {
    try {
      if (typeof fs.existsSync === 'function' && !fs.existsSync(DATA_DIR)) {
        if (typeof fs.mkdirSync === 'function') {
          fs.mkdirSync(DATA_DIR, { recursive: true })
        }
      }
    } catch (_) {}
  }

  /**
   * Initializes Firebase cloud sync.
   */
  init (database) {
    this._database = database
    if (!this._database || typeof this._database.ref !== 'function') return

    try {
      const wfRef = this._database.ref('agent_workflows')
      wfRef.once('value').then(snapshot => {
        if (snapshot && typeof snapshot.exists === 'function' && snapshot.exists()) {
          const remoteWfs = snapshot.val()
          if (Array.isArray(remoteWfs)) {
            const localMap = new Map(this._workflows.map(w => [w.id, w]))
            for (const rw of remoteWfs) {
              if (!localMap.has(rw.id)) {
                this._workflows.push(rw)
              }
            }
            this._saveLocalOnly()
            this._syncRemote()
            logger.info(`WorkflowEngine: Hydrated ${remoteWfs.length} workflows from Firebase and synced baseline.`)
          }
        } else if (this._workflows.length > 0) {
          this._syncRemote()
          logger.info('WorkflowEngine: Seeded Firebase with initial local workflows.')
        }
      }).catch(err => {
        logger.warn(`WorkflowEngine: Firebase initial sync warning: ${err.message}`)
      })
    } catch (err) {
      logger.warn(`WorkflowEngine: Failed to setup Firebase sync: ${err.message}`)
    }
  }

  _syncRemote () {
    if (!this._database || typeof this._database.ref !== 'function') return
    if (this._syncTimer) clearTimeout(this._syncTimer)

    this._syncTimer = setTimeout(() => {
      try {
        this._database.ref('agent_workflows').set(this._workflows)
          .then(() => logger.debug('WorkflowEngine: Successfully synced workflows to Firebase.'))
          .catch(e => logger.warn(`WorkflowEngine: Firebase sync error: ${e.message}`))
      } catch (err) {
        logger.warn(`WorkflowEngine: Failed to dispatch Firebase sync: ${err.message}`)
      }
    }, 500)
    if (this._syncTimer.unref) this._syncTimer.unref()
  }

  _load () {
    try {
      if (typeof fs.existsSync === 'function' && fs.existsSync(WORKFLOWS_FILE)) {
        if (typeof fs.readFileSync === 'function') {
          const raw = fs.readFileSync(WORKFLOWS_FILE, 'utf8')
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            this._workflows = parsed
            return
          }
        }
      }
    } catch (err) {
      logger.warn(`WorkflowEngine: Failed to load workflows: ${err.message}`)
    }
    this._workflows = []
  }

  _saveLocalOnly () {
    if (process.env.NODE_ENV === 'test') return
    try {
      this._ensureDataDir()
      if (typeof fs.writeFileSync === 'function') {
        fs.writeFileSync(WORKFLOWS_FILE, JSON.stringify(this._workflows, null, 2), 'utf8')
      }
    } catch (err) {
      logger.error(`WorkflowEngine: Failed to save workflows to disk: ${err.message}`)
    }
  }

  _save () {
    this._saveLocalOnly()
    this._syncRemote()
  }

  listWorkflows () {
    return [...this._workflows]
  }

  getWorkflow (idOrName) {
    if (!idOrName) return null
    const clean = String(idOrName).trim().toLowerCase()
    return this._workflows.find(w => w.id === idOrName || (w.name && w.name.toLowerCase() === clean)) || null
  }

  createWorkflow ({
    name,
    description = '',
    channelId = null,
    guildId = null,
    steps = [],
    enabled = true
  }) {
    if (!name) throw new Error('Workflow name is required.')
    if (!Array.isArray(steps) || steps.length === 0) throw new Error('Workflow must contain at least one step in "steps".')

    const cleanName = String(name).trim().replace(/[^a-zA-Z0-9_-]/g, '_')
    const id = `wf_${cleanName}_${Date.now().toString(36)}`

    const workflow = {
      id,
      name: cleanName,
      description: description || cleanName,
      channelId,
      guildId,
      steps,
      enabled: enabled !== false,
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      lastRunStatus: null
    }

    this._workflows.push(workflow)
    this._save()
    logger.info(`WorkflowEngine: Registered workflow "${workflow.name}" (${workflow.id}) with ${steps.length} steps.`)
    return workflow
  }

  updateWorkflow (idOrName, updates = {}) {
    const wf = this.getWorkflow(idOrName)
    if (!wf) return null
    if (updates.name) wf.name = String(updates.name).trim().replace(/[^a-zA-Z0-9_-]/g, '_')
    if (updates.description !== undefined) wf.description = updates.description
    if (updates.channelId !== undefined) wf.channelId = updates.channelId
    if (updates.guildId !== undefined) wf.guildId = updates.guildId
    if (Array.isArray(updates.steps)) wf.steps = updates.steps
    if (updates.enabled !== undefined) wf.enabled = Boolean(updates.enabled)
    this._save()
    logger.info(`WorkflowEngine: Updated workflow "${wf.name}" (${wf.id})`)
    return wf
  }

  deleteWorkflow (idOrName) {
    const wf = this.getWorkflow(idOrName)
    if (!wf) return false
    this._workflows = this._workflows.filter(w => w.id !== wf.id)
    this._save()
    logger.info(`WorkflowEngine: Deleted workflow "${wf.name}" (${wf.id})`)
    return true
  }

  // ─── Variable Resolution & Interpolation ───────────────────────────────────

  static extractVersionOrPatch (rawText) {
    if (!rawText) return null
    const text = typeof rawText === 'object'
      ? (rawText.summary || rawText.output || JSON.stringify(rawText))
      : String(rawText)

    // Clean out markdown asterisks/formatting for uniform matching
    const cleanText = text.replace(/[*_#`]/g, '')

    // 1. Check for explicit "Current Patch: X.Y", "Patch X.Y is live", "Patch X.Y Live"
    const explicitCurrentMatch = cleanText.match(/\b(?:current|live)\s+patch[:\s]+(?:patch\s*)?(?:v\s*)?(\d{1,2}\.\d{1,2})\b/i) ||
                                cleanText.match(/\bpatch\s*[:#-]?\s*(\d{1,2}\.\d{1,2})\s+(?:is\s+)?(?:now\s+)?live\b/i)
    if (explicitCurrentMatch) return explicitCurrentMatch[1]

    // 2. Extract all version candidates, but exclude any explicitly described as next/upcoming/scheduled
    const matches = Array.from(cleanText.matchAll(/\b(?:patch\s*[:#-]?\s*|v\s*)(\d{1,2}\.\d{1,2})\b/gi))
    if (matches.length === 0) return null

    const validVersions = []
    for (const m of matches) {
      const idx = m.index
      const prefix = cleanText.substring(Math.max(0, idx - 40), idx).toLowerCase()
      // Skip if marked as next, upcoming, pbe, or scheduled
      if (prefix.includes('next') || prefix.includes('upcoming') || prefix.includes('scheduled') || prefix.includes('pbe')) {
        continue
      }
      validVersions.push(m[1])
    }

    if (validVersions.length === 0) return null

    // Pick highest valid released version
    validVersions.sort((a, b) => {
      const [aMaj, aMin] = a.split('.').map(Number)
      const [bMaj, bMin] = b.split('.').map(Number)
      if (aMaj !== bMaj) return bMaj - aMaj
      return bMin - aMin
    })

    return validVersions[0]
  }

  _resolveValue (val, stepResults, previousResult, context) {
    if (typeof val === 'string') {
      if (val === '$results' || val === '$prev') return previousResult

      // Support $steps.<step_name> or $steps.<step_name>.<path> (exact single token, no operators)
      if (val.startsWith('$steps.') && !/\s|[!=<>]/.test(val)) {
        const parts = val.substring(7).split('.')
        const stepName = parts[0]
        const subPath = parts.slice(1).join('.')
        const stepIdx = context?.stepNameToIndex?.[stepName]
        if (stepIdx !== undefined) {
          const stepObj = stepResults[stepIdx]
          if (subPath && (subPath === 'hasChanged' || subPath.endsWith('.hasChanged'))) {
            if (stepObj && typeof stepObj === 'object') {
              let resolved = subPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, stepObj)
              if (resolved === undefined && (subPath.startsWith('output.') || subPath.startsWith('result.'))) {
                const altPath = subPath.replace(/^(output|result)\./, '')
                resolved = altPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, stepObj)
              }
              return resolved === true
            }
            return false
          }
          if (subPath && stepObj && typeof stepObj === 'object') {
            let resolved = subPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, stepObj)
            // If subPath begins with "output." or "result." but stepObj has properties directly, check fallback
            if (resolved === undefined && (subPath.startsWith('output.') || subPath.startsWith('result.'))) {
              const altPath = subPath.replace(/^(output|result)\./, '')
              resolved = altPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, stepObj)
            }
            if (resolved !== undefined) return resolved
          }
          if (subPath && (subPath === 'patch' || subPath.endsWith('.patch') || subPath === 'version' || subPath.endsWith('.version'))) {
            return WorkflowEngine.extractVersionOrPatch(stepObj)
          }
          if (subPath === 'output' || subPath === 'result') {
            return stepObj
          }
          if (!subPath && stepObj !== undefined) return stepObj
          return null
        }
      }

      if (val.startsWith('$step') && !/\s|[!=<>]/.test(val)) {
        const match = val.match(/^\$step(\d+)(\..+)?$/)
        if (match) {
          const stepIndex = parseInt(match[1], 10) - 1
          const subPath = match[2] ? match[2].substring(1) : null
          const stepObj = stepResults[stepIndex]
          if (subPath && (subPath === 'hasChanged' || subPath.endsWith('.hasChanged'))) {
            if (stepObj && typeof stepObj === 'object') {
              let resolved = subPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, stepObj)
              if (resolved === undefined && (subPath.startsWith('output.') || subPath.startsWith('result.'))) {
                const altPath = subPath.replace(/^(output|result)\./, '')
                resolved = altPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, stepObj)
              }
              return resolved === true
            }
            return false
          }
          if (subPath && stepObj && typeof stepObj === 'object') {
            let resolved = subPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, stepObj)
            if (resolved === undefined && (subPath.startsWith('output.') || subPath.startsWith('result.'))) {
              const altPath = subPath.replace(/^(output|result)\./, '')
              resolved = altPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, stepObj)
            }
            if (resolved !== undefined) return resolved
          }
          if (subPath && (subPath === 'patch' || subPath.endsWith('.patch') || subPath === 'version' || subPath.endsWith('.version'))) {
            return WorkflowEngine.extractVersionOrPatch(stepObj)
          }
          if (subPath === 'output' || subPath === 'result') {
            return stepObj
          }
          if (!subPath && stepObj !== undefined) return stepObj
          return null
        }
      }
      if (val.startsWith('$state.')) {
        const stateKey = val.substring(7)
        return stateStore.get(stateKey, null)
      }
      if (val === '$channelId') return context.channelId || null
      if (val === '$guildId') return context.guildId || null

      // Inline string replacements (e.g. "Latest: $results", "$steps.search_latest_patch.output")
      let out = val
      if (out.includes('$results')) {
        out = out.replace(/\$results/g, typeof previousResult === 'object' ? JSON.stringify(previousResult) : String(previousResult || ''))
      }
      if (out.includes('$channelId')) {
        out = out.replace(/\$channelId/g, String(context.channelId || ''))
      }
      // Replace embedded $steps.<step_name> references
      out = out.replace(/\$steps\.([a-zA-Z0-9_-]+)(?:\.([a-zA-Z0-9_.-]+))?/g, (fullMatch, sName, sPath) => {
        const stepIdx = context?.stepNameToIndex?.[sName]
        if (stepIdx !== undefined) {
          const stepObj = stepResults[stepIdx]
          if (sPath && (sPath === 'hasChanged' || sPath.endsWith('.hasChanged'))) {
            if (stepObj && typeof stepObj === 'object') {
              let resolved = sPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, stepObj)
              if (resolved === undefined && (sPath.startsWith('output.') || sPath.startsWith('result.'))) {
                const altPath = sPath.replace(/^(output|result)\./, '')
                resolved = altPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, stepObj)
              }
              return String(resolved === true)
            }
            return 'false'
          }
          if (sPath && stepObj && typeof stepObj === 'object') {
            let resolved = sPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, stepObj)
            if (resolved === undefined && (sPath.startsWith('output.') || sPath.startsWith('result.'))) {
              const altPath = sPath.replace(/^(output|result)\./, '')
              resolved = altPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, stepObj)
            }
            if (resolved !== undefined) return typeof resolved === 'object' ? JSON.stringify(resolved) : String(resolved)
          }
          if (sPath && (sPath === 'patch' || sPath.endsWith('.patch') || sPath === 'version' || sPath.endsWith('.version'))) {
            const patch = WorkflowEngine.extractVersionOrPatch(stepObj)
            return patch !== null ? patch : ''
          }
          if (sPath === 'output' || sPath === 'result') {
            return typeof stepObj === 'object' ? JSON.stringify(stepObj) : String(stepObj)
          }
          if (!sPath && stepObj !== undefined) return typeof stepObj === 'object' ? JSON.stringify(stepObj) : String(stepObj)
          return ''
        }
        return fullMatch
      })
      return out
    }

    if (Array.isArray(val)) {
      return val.map(item => this._resolveValue(item, stepResults, previousResult, context))
    }

    if (val && typeof val === 'object') {
      const resolved = {}
      for (const [k, v] of Object.entries(val)) {
        resolved[k] = this._resolveValue(v, stepResults, previousResult, context)
      }
      return resolved
    }

    return val
  }

  _evaluateCondition (condition, previousResult, stepResults, params, context = {}) {
    if (!condition || condition === 'always') return true
    if (condition === 'never') return false

    if (condition === 'changed') {
      if (previousResult && typeof previousResult === 'object' && typeof previousResult.hasChanged === 'boolean') {
        return previousResult.hasChanged === true
      }
      if (params && (params.diff_key || params.key)) {
        const diffRes = stateStore.diff(params.diff_key || params.key, previousResult)
        return diffRes.hasChanged === true
      }
      return false
    }

    if (condition === 'truthy') {
      if (previousResult && typeof previousResult === 'object' && typeof previousResult.hasChanged === 'boolean') {
        return previousResult.hasChanged === true
      }
      return Boolean(previousResult)
    }

    if (condition === 'falsy') {
      if (previousResult && typeof previousResult === 'object' && typeof previousResult.hasChanged === 'boolean') {
        return previousResult.hasChanged === false
      }
      return !previousResult
    }

    // Support expression evaluation like "$steps.compare_patch_baseline.output.hasChanged == true"
    if (typeof condition === 'string') {
      const compMatch = condition.match(/^\s*(.+?)\s*(==|!=)\s*(.+?)\s*$/)
      if (compMatch) {
        const leftRaw = compMatch[1].trim()
        const op = compMatch[2]
        const rightRaw = compMatch[3].trim()

        const leftResolved = this._resolveValue(leftRaw, stepResults, previousResult, context)
        const rightResolved = this._resolveValue(rightRaw, stepResults, previousResult, context)

        const normalize = (v) => {
          if (typeof v === 'boolean') return v
          if (v === 'true') return true
          if (v === 'false') return false
          if (v === 'null') return null
          if (v === 'undefined') return undefined
          if (!isNaN(v) && v !== '' && typeof v === 'string') return Number(v)
          return v
        }

        let leftVal = normalize(leftResolved)
        let rightVal = normalize(rightResolved)

        if ((leftRaw === 'hasChanged' || leftRaw.endsWith('.hasChanged')) && typeof leftVal !== 'boolean') {
          leftVal = false
        }
        if ((rightRaw === 'hasChanged' || rightRaw.endsWith('.hasChanged')) && typeof rightVal !== 'boolean') {
          rightVal = false
        }

        if (op === '==') return leftVal === rightVal
        if (op === '!=') return leftVal !== rightVal
      }

      const resolved = this._resolveValue(condition, stepResults, previousResult, context)
      if (typeof resolved === 'boolean') return resolved
      if (typeof resolved === 'object' && resolved !== null && typeof resolved.hasChanged === 'boolean') {
        return resolved.hasChanged === true
      }
      if (condition === 'hasChanged' || condition.endsWith('.hasChanged')) {
        return resolved === true
      }
      return Boolean(resolved)
    }

    return true
  }

  // ─── Execution ─────────────────────────────────────────────────────────────

  async executeWorkflow (idOrName, { bot, channel, extraContext = {} } = {}) {
    const wf = this.getWorkflow(idOrName)
    if (!wf) throw new Error(`Workflow "${idOrName}" not found.`)

    logger.info(`WorkflowEngine: Starting execution of workflow "${wf.name}" (${wf.id})...`)
    const stepResults = []
    let previousResult = null
    const executionLogs = []

    const stepNameToIndex = {}
    for (let i = 0; i < wf.steps.length; i++) {
      if (wf.steps[i]?.name) {
        stepNameToIndex[wf.steps[i].name] = i
      }
    }

    const context = {
      workflowId: wf.id,
      workflowName: wf.name,
      channelId: channel?.id || wf.channelId,
      guildId: channel?.guild?.id || wf.guildId,
      stepNameToIndex,
      ...extraContext
    }

    let targetChannel = channel
    if (!targetChannel && wf.channelId && bot) {
      try {
        targetChannel = await bot.channels.fetch(wf.channelId).catch(() => null)
      } catch (_) {}
    }

    for (let i = 0; i < wf.steps.length; i++) {
      const step = wf.steps[i]
      const stepName = step.name || `step_${i + 1}`
      const actionName = step.action

      if (!actionName) {
        executionLogs.push(`⚠️ Step ${i + 1} (${stepName}): Missing action name, skipping.`)
        continue
      }

      // Check condition
      const shouldRun = this._evaluateCondition(step.condition, previousResult, stepResults, step.params, context)
      if (!shouldRun) {
        executionLogs.push(`⏭️ Step ${i + 1} (${stepName}): Condition "${step.condition}" evaluated to false, skipped.`)
        stepResults.push(null)
        continue
      }

      // Resolve parameters
      const resolvedParams = this._resolveValue(step.params || {}, stepResults, previousResult, context)

      try {
        logger.info(`WorkflowEngine: Executing step ${i + 1} "${stepName}" [${actionName}]...`)
        const actionExecutor = require('../util/ActionExecutor')
        const result = await actionExecutor.executeAction(actionName, bot, targetChannel, resolvedParams, context)

        stepResults.push(result)
        previousResult = result
        executionLogs.push(`✅ Step ${i + 1} (${stepName}) [${actionName}]: Success`)
      } catch (err) {
        logger.error(`WorkflowEngine: Error executing step ${i + 1} "${stepName}" [${actionName}]: ${err.message}`)
        executionLogs.push(`❌ Step ${i + 1} (${stepName}) [${actionName}]: Failed — ${err.message}`)
        wf.lastRunStatus = `Failed at step ${i + 1} (${actionName}): ${err.message}`
        wf.lastRunAt = new Date().toISOString()
        this._save()
        return {
          success: false,
          error: err.message,
          stepIndex: i + 1,
          stepName,
          executionLogs,
          stepResults
        }
      }
    }

    wf.lastRunStatus = 'Success'
    wf.lastRunAt = new Date().toISOString()
    this._save()

    logger.info(`WorkflowEngine: Completed workflow "${wf.name}" (${wf.id}) successfully.`)
    return {
      success: true,
      workflowName: wf.name,
      executionLogs,
      finalResult: previousResult,
      stepResults
    }
  }
}

module.exports = new WorkflowEngine()
