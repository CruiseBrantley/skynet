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
            const existingIds = new Set(this._workflows.map(w => w.id))
            for (const rw of remoteWfs) {
              if (!existingIds.has(rw.id)) {
                this._workflows.push(rw)
              }
            }
            this._saveLocalOnly()
            logger.info(`WorkflowEngine: Hydrated ${remoteWfs.length} workflows from Firebase.`)
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
    try {
      this._ensureDataDir()
      if (typeof fs.writeFileSync === 'function') {
        fs.writeFileSync(WORKFLOWS_FILE, JSON.stringify(this._workflows, null, 2), 'utf8')
      }
    } catch (err) {
      logger.error(`WorkflowEngine: Failed to save workflows: ${err.message}`)
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

  deleteWorkflow (idOrName) {
    const wf = this.getWorkflow(idOrName)
    if (!wf) return false
    this._workflows = this._workflows.filter(w => w.id !== wf.id)
    this._save()
    logger.info(`WorkflowEngine: Deleted workflow "${wf.name}" (${wf.id})`)
    return true
  }

  // ─── Variable Resolution & Interpolation ───────────────────────────────────

  _resolveValue (val, stepResults, previousResult, context) {
    if (typeof val === 'string') {
      if (val === '$results' || val === '$prev') return previousResult
      if (val.startsWith('$step')) {
        const match = val.match(/^\$step(\d+)(\..+)?$/)
        if (match) {
          const stepIndex = parseInt(match[1], 10) - 1
          const subPath = match[2] ? match[2].substring(1) : null
          const stepObj = stepResults[stepIndex]
          if (subPath && stepObj && typeof stepObj === 'object') {
            return stepObj[subPath] !== undefined ? stepObj[subPath] : val
          }
          return stepObj !== undefined ? stepObj : val
        }
      }
      if (val.startsWith('$state.')) {
        const stateKey = val.substring(7)
        return stateStore.get(stateKey, null)
      }
      if (val === '$channelId') return context.channelId || null
      if (val === '$guildId') return context.guildId || null

      // Inline string replacements (e.g. "Latest: $results")
      let out = val
      if (out.includes('$results')) {
        out = out.replace(/\$results/g, typeof previousResult === 'object' ? JSON.stringify(previousResult) : String(previousResult || ''))
      }
      if (out.includes('$channelId')) {
        out = out.replace(/\$channelId/g, String(context.channelId || ''))
      }
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

  _evaluateCondition (condition, previousResult, stepResults, params) {
    if (!condition || condition === 'always') return true

    if (condition === 'changed') {
      // If diff_key is specified in params or compare_baseline
      if (params && params.diff_key) {
        const diffRes = stateStore.diff(params.diff_key, previousResult)
        return diffRes.hasChanged
      }
      return previousResult !== null && previousResult !== undefined && previousResult !== ''
    }

    if (condition === 'truthy') {
      return Boolean(previousResult)
    }

    if (condition === 'falsy') {
      return !previousResult
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

    const context = {
      workflowId: wf.id,
      workflowName: wf.name,
      channelId: channel?.id || wf.channelId,
      guildId: channel?.guild?.id || wf.guildId,
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
      const shouldRun = this._evaluateCondition(step.condition, previousResult, stepResults, step.params)
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
