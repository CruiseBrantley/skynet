const loginFirebase = require('../firebase-login')
const setupConfigSync = require('../util/configSync')
const logger = require('../logger')
const stateStore = require('./state')
const workflowEngine = require('./workflows')
const triggerEngine = require('./triggers')
const agentMemory = require('./memory')
const agentScheduler = require('./scheduler')
const agentLoop = require('../util/AgentLoop')
const InstanceGuardian = require('./guardian')
const telemetry = require('./telemetry')
const { agentTurn, AgentTurnManager } = require('./agent')
const conversationStore = require('./conversationStore')

class CoreController {
  constructor ({ database, config = {} } = {}) {
    this.botName = config.botName || process.env.BOT_NAME || 'Skynet'
    this.database = database || null
    this.isDaemon = config.isDaemon ?? false
    this.configSync = null
    this.conversationStore = conversationStore
    this.clients = new Map()
    this.turnManager = new AgentTurnManager({ botName: this.botName })
    this.isInitialized = false
  }

  async init () {
    if (this.isInitialized) return this
    logger.info('SkynetCore: Initializing central engine...')

    if (!this.database) {
      this.database = loginFirebase()
    }
    this.configSync = setupConfigSync(this.database)

    // Hydrate persistent engines
    try {
      if (typeof stateStore.init === 'function') stateStore.init(this.database)
      if (typeof workflowEngine.init === 'function') workflowEngine.init(this.database)
      if (typeof agentMemory.init === 'function') agentMemory.init(this.database)
      if (typeof triggerEngine.init === 'function') triggerEngine.init({ database: this.database })
      if (typeof telemetry.init === 'function') telemetry.init()
    } catch (e) {
      logger.warn(`SkynetCore: Store initialization warning: ${e.message}`)
    }

    // Start autonomous schedulers and guardian if running as persistent daemon
    if (this.isDaemon) {
      agentScheduler.start(this)
      if (typeof agentLoop.start === 'function') {
        agentLoop.start(this)
      }

      try {
        this.guardian = new InstanceGuardian(this.database)
        this.guardian.init().catch(e => logger.warn(`InstanceGuardian init warning: ${e.message}`))
      } catch (e) {
        logger.warn(`InstanceGuardian init error: ${e.message}`)
      }
    }

    this.isInitialized = true
    logger.info('SkynetCore: Central engine initialized successfully.')
    return this
  }

  registerClient (clientAdapter) {
    if (!clientAdapter || !clientAdapter.id) {
      throw new Error('SkynetCore.registerClient: Invalid adapter instance.')
    }
    logger.info(`SkynetCore: Registering client adapter "${clientAdapter.name}" (${clientAdapter.id})...`)
    this.clients.set(clientAdapter.id, clientAdapter)
    clientAdapter.start(this)
    logger.info(`SkynetCore: Client adapter "${clientAdapter.id}" is active.`)
    return clientAdapter
  }

  unregisterClient (clientId) {
    const adapter = this.clients.get(clientId)
    if (adapter) {
      adapter.stop()
      this.clients.delete(clientId)
      logger.info(`SkynetCore: Unregistered client adapter "${clientId}".`)
    }
  }

  getClient (clientId) {
    return this.clients.get(clientId)
  }

  listClients () {
    return Array.from(this.clients.values())
  }

  async agentTurn (params) {
    return await agentTurn({ ...params, botName: this.botName })
  }
}

/**
 * Global entry point to initialize the Skynet Core engine.
 * @param {object} [options]
 * @param {object} [options.database] - Firebase database reference.
 * @param {object} [options.config] - Optional configuration overrides.
 * @returns {Promise<CoreController>}
 */
async function initCore ({ database = null, config = {} } = {}) {
  const core = new CoreController({ database, config })
  await core.init()
  return core
}

module.exports = {
  initCore,
  CoreController,
  agentTurn,
  stateStore,
  agentMemory,
  agentScheduler,
  triggerEngine,
  workflowEngine,
  telemetry
}
