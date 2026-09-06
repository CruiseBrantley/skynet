const fs = require('fs')
const path = require('path')
const logger = require('../logger')
const loginFirebase = require('../firebase-login')
const AgentTurnManager = require('../util/chat/AgentTurnManager')
const stateStore = require('../util/StateStore')
const workflowEngine = require('../util/WorkflowEngine')
const triggerEngine = require('../util/TriggerEngine')
const agentMemory = require('../util/AgentMemory')
const agentLoop = require('../util/AgentLoop')
const agentScheduler = require('../util/AgentScheduler')
const InstanceGuardian = require('../util/InstanceGuardian')
const setupConfigSync = require('../util/configSync')
const conversationStore = require('./conversationStore')

class SkynetCore {
  constructor ({ botName = 'Skynet', commandsDir = null, isDaemon = false } = {}) {
    this.botName = botName || process.env.BOT_NAME || 'Skynet'
    this.commandsDir = commandsDir || path.join(__dirname, '..', 'commands')
    this.isDaemon = isDaemon
    this.database = null
    this.configSync = null
    this.conversationStore = conversationStore
    this.clients = new Map()
    this.commands = new Map()
    this.turnManager = new AgentTurnManager({ botName: this.botName })
    this.isInitialized = false
  }

  /**
   * Initializes central persistent stores, intelligence engines, and commands.
   */
  async init () {
    if (this.isInitialized) return
    logger.info('SkynetCore: Initializing central engine...')

    // 1. Initialize Firebase Database
    this.database = loginFirebase()
    this.configSync = setupConfigSync(this.database)

    // 2. Hydrate Firebase Engines
    try {
      if (typeof stateStore.init === 'function') stateStore.init(this.database)
      if (typeof workflowEngine.init === 'function') workflowEngine.init(this.database)
      if (typeof agentMemory.init === 'function') agentMemory.init(this.database)
      if (typeof triggerEngine.init === 'function') triggerEngine.init({ database: this.database })
    } catch (e) {
      logger.warn(`Store initialization warning: ${e.message}`)
    }

    // 3. Load Commands
    this._loadCommands()

    // 4. Start Central Scheduler, Background Loop, and Instance Guardian if daemon
    if (this.isDaemon) {
      if (!this._schedulerInterval) {
        this._schedulerInterval = setInterval(() => agentScheduler.processDueTasks(this), 60_000)
        if (this._schedulerInterval.unref) this._schedulerInterval.unref()
      }
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
  }

  /**
   * Loads command files from commands directory into internal registry.
   */
  _loadCommands () {
    this.commands.clear()
    if (!fs.existsSync(this.commandsDir)) return

    const files = fs.readdirSync(this.commandsDir).filter(f => f.endsWith('.js') && f !== 'chat.js')
    for (const file of files) {
      try {
        const filePath = path.join(this.commandsDir, file)
        const command = require(filePath)
        if ('data' in command && 'execute' in command) {
          this.commands.set(command.data.name, command)
        }
      } catch (err) {
        logger.warn(`SkynetCore: Could not load command ${file}: ${err.message}`)
      }
    }
    logger.info(`SkynetCore: Loaded ${this.commands.size} commands into registry.`)
  }

  /**
   * Registers a client adapter.
   * @param {import('../interfaces/IClientAdapter')} clientAdapter
   */
  async registerClient (clientAdapter) {
    if (!clientAdapter || !clientAdapter.id) {
      throw new Error('SkynetCore.registerClient: Invalid adapter instance.')
    }
    logger.info(`SkynetCore: Registering client adapter "${clientAdapter.name}" (${clientAdapter.id})...`)
    this.clients.set(clientAdapter.id, clientAdapter)
    await clientAdapter.start(this)
    logger.info(`SkynetCore: Client adapter "${clientAdapter.id}" is active.`)
  }

  /**
   * Unregisters and stops a client adapter.
   * @param {string} clientId
   */
  async unregisterClient (clientId) {
    const adapter = this.clients.get(clientId)
    if (adapter) {
      await adapter.stop()
      this.clients.delete(clientId)
      logger.info(`SkynetCore: Unregistered client adapter "${clientId}".`)
    }
  }

  /**
   * Returns a registered client adapter by ID.
   * @param {string} clientId
   * @returns {import('../interfaces/IClientAdapter')|undefined}
   */
  getClient (clientId) {
    return this.clients.get(clientId)
  }

  /**
   * Lists all active client adapters.
   */
  listClients () {
    return Array.from(this.clients.values())
  }

  /**
   * Central Dispatcher: Dispatches normalized interactions to commands or dynamic components.
   * @param {import('../interfaces/NormalizedInteraction')} interaction
   */
  async dispatchInteraction (interaction) {
    // 1. Dynamic Button & Component Dispatch
    if (interaction.customId) {
      const prefix = interaction.customId.split(/[_:]/)[0]
      const command = this.commands.get(prefix)

      if (command) {
        const handler = command.buttonHandler || command.handleButton || command.handleInteraction || command.handleSelectMenu || command.handleModal
        if (typeof handler === 'function') {
          try {
            return await handler(interaction.raw || interaction)
          } catch (error) {
            logger.error(`SkynetCore: Dynamic component error for "${prefix}": ${error.stack || error.message}`)
            if (!interaction.replied && !interaction.deferred) {
              await interaction.reply({ content: 'Component interaction failed.', ephemeral: true }).catch(() => {})
            }
            return
          }
        }
      }
    }

    // 2. Slash Command Dispatch
    if (interaction.commandName) {
      const command = this.commands.get(interaction.commandName)
      if (!command) {
        return interaction.reply({ content: `Command "${interaction.commandName}" not found.`, ephemeral: true })
      }

      try {
        return await command.execute(interaction.raw || interaction, this.database)
      } catch (err) {
        logger.error(`SkynetCore: Error executing command /${interaction.commandName}: ${err.stack || err.message}`)
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `Error executing /${interaction.commandName}: ${err.message}`, ephemeral: true }).catch(() => {})
        } else {
          await interaction.editReply({ content: `Error executing /${interaction.commandName}: ${err.message}` }).catch(() => {})
        }
      }
    }
  }

  /**
   * Broadcasts a proactive message across all capable client adapters.
   */
  async broadcast (payload) {
    const results = []
    for (const client of this.clients.values()) {
      try {
        const res = await client.sendMessage('broadcast', payload)
        results.push({ clientId: client.id, success: true, res })
      } catch (e) {
        results.push({ clientId: client.id, success: false, error: e.message })
      }
    }
    return results
  }
}

module.exports = SkynetCore
