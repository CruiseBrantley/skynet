const fs = require('fs')
const path = require('path')
const logger = require('../logger')

const DATA_DIR = path.join(__dirname, '../data')
const TASKS_FILE = path.join(DATA_DIR, 'agent_tasks.json')

/**
 * Singleton persistent task scheduler.
 * Stores scheduled tasks to local disk at data/agent_tasks.json.
 * Owns its own independent 60-second evaluation interval.
 */
class AgentScheduler {
  constructor () {
    this._ensureDataDir()
    this._tasks = this._load()
    this._interval = null
    this._core = null
  }

  _ensureDataDir () {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
  }

  _load () {
    try {
      if (fs.existsSync(TASKS_FILE)) {
        return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'))
      }
    } catch (e) {
      logger.warn(`AgentScheduler: Failed to load tasks: ${e.message}`)
    }
    return []
  }

  _save () {
    try {
      fs.writeFileSync(TASKS_FILE, JSON.stringify(this._tasks, null, 2))
    } catch (e) {
      logger.error(`AgentScheduler: Failed to save tasks: ${e.message}`)
    }
  }

  /**
   * Start the scheduler background tick.
   * @param {object} core - Central SkynetCore instance or bot client.
   */
  start (core) {
    this._core = core
    if (this._interval) return
    logger.info('AgentScheduler: Tick started (60s interval).')
    this._interval = setInterval(() => this.processDueTasks(this._core), 60_000)
    if (this._interval.unref) this._interval.unref()
  }

  /**
   * Stop the scheduler background tick.
   */
  stop () {
    if (this._interval) {
      clearInterval(this._interval)
      this._interval = null
      logger.info('AgentScheduler: Stopped.')
    }
  }

  /**
   * Add a new scheduled task.
   */
  add (task) {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    let resolvedChannelId = task.channelId || 'dm'
    if (resolvedChannelId === 'current' || resolvedChannelId === 'terminal' || resolvedChannelId.startsWith('cli_') || resolvedChannelId.startsWith('web_')) {
      resolvedChannelId = 'dm'
    }

    const entry = {
      id,
      description: task.description,
      scheduledAt: task.scheduledAt,
      userId: task.userId || null,
      guildId: task.guildId || null,
      channelId: resolvedChannelId,
      repeat: task.repeat || null,
      action: task.action || null,
      params: task.params || null,
      createdAt: Date.now(),
      createdBy: task.createdBy || 'unknown'
    }
    this._tasks.push(entry)
    this._save()
    logger.info(`AgentScheduler: Scheduled task ${id} - "${task.description.substring(0, 60)}" at ${new Date(task.scheduledAt).toLocaleString()}`)
    return entry
  }

  getDue () {
    const now = Date.now()
    return this._tasks.filter(t => t.scheduledAt <= now)
  }

  complete (id) {
    const before = this._tasks.length
    this._tasks = this._tasks.filter(t => t.id !== id)
    if (this._tasks.length < before) {
      this._save()
      logger.info(`AgentScheduler: Completed and removed task ${id}.`)
    }
  }

  reschedule (id) {
    const task = this._tasks.find(t => t.id === id)
    if (!task || !task.repeat) return

    const intervals = { hourly: 3_600_000, daily: 86_400_000, weekly: 604_800_000 }
    const interval = intervals[task.repeat]
    if (interval) {
      const now = Date.now()
      while (task.scheduledAt <= now) {
        task.scheduledAt += interval
      }
      this._save()
      logger.info(`AgentScheduler: Rescheduled task ${id} → ${new Date(task.scheduledAt).toLocaleString()}`)
    }
  }

  update (id, updates) {
    const task = this._tasks.find(t => t.id === id)
    if (!task) return null

    if (updates.description !== undefined) task.description = updates.description
    if (updates.scheduledAt !== undefined) task.scheduledAt = updates.scheduledAt
    if (updates.channelId !== undefined) {
      let resolved = updates.channelId || 'dm'
      if (resolved === 'current' || resolved === 'terminal' || resolved.startsWith('cli_') || resolved.startsWith('web_')) {
        resolved = 'dm'
      }
      task.channelId = resolved
    }
    if (updates.repeat !== undefined) task.repeat = updates.repeat
    if (updates.guildId !== undefined) task.guildId = updates.guildId

    this._save()
    logger.info(`AgentScheduler: Updated task ${id}.`)
    return task
  }

  cancel (id) {
    const before = this._tasks.length
    this._tasks = this._tasks.filter(t => t.id !== id)
    if (this._tasks.length < before) {
      this._save()
      logger.info(`AgentScheduler: Cancelled task ${id}.`)
      return true
    }
    return false
  }

  getAll () {
    return [...this._tasks]
  }

  getByUser (userId) {
    return this._tasks.filter(t => t.userId === userId)
  }

  /**
   * Process all due tasks and deliver them via ActionExecutor.
   * @param {object} coreOrBot
   */
  async processDueTasks (coreOrBot) {
    const actionExecutor = require('../util/ActionExecutor')
    const dueTasks = this.getDue()

    // Resolve client handle (prefer discord client adapter if available)
    const target = (typeof coreOrBot?.getClient === 'function' ? coreOrBot.getClient('discord')?.client : null) ||
                   (typeof coreOrBot?.listClients === 'function' ? coreOrBot.listClients().find(c => c.id === 'discord')?.client || coreOrBot.listClients()[0]?.client : null) ||
                   coreOrBot?.client ||
                   coreOrBot

    for (const task of dueTasks) {
      try {
        const delivered = await actionExecutor.execute(target, task)

        if (!delivered) {
          logger.warn(`AgentScheduler: Task ${task.id} could not be delivered — will retry next tick.`)
          continue
        }

        if (task.repeat) {
          this.reschedule(task.id)
        } else {
          this.complete(task.id)
        }
      } catch (err) {
        logger.error(`AgentScheduler: Unexpected error processing task ${task.id}: ${err.message}`)
      }
    }
  }

  size () {
    return this._tasks.length
  }
}

module.exports = new AgentScheduler()
