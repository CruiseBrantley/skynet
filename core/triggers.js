const fs = require('fs')
const path = require('path')
const os = require('os')
const logger = require('../logger')

const DATA_DIR = path.join(__dirname, '../data')
const TRIGGERS_FILE = path.join(DATA_DIR, 'agent_triggers.json')
const BACKUPS_DIR = path.join(DATA_DIR, 'command_backups')

class TriggerEngine {
  constructor ({ telemetry, selfHealing } = {}) {
    this.telemetry = telemetry || null
    this.selfHealing = selfHealing || null
    this.client = null
    this._triggers = []
    this._lastFired = new Map() // triggerId -> timestamp ms
    this._watchdogTimer = null
    this._ensureDataDir()
    this._load()
  }

  init ({ telemetry, selfHealing, client, database } = {}) {
    if (telemetry) this.telemetry = telemetry
    if (selfHealing) this.selfHealing = selfHealing
    if (client) this.client = client
    if (database) {
      this._database = database
      this._setupFirebaseSync()
    }
    this._load()
  }

  _setupFirebaseSync () {
    if (!this._database || typeof this._database.ref !== 'function') return
    try {
      const trigRef = this._database.ref('agent_triggers')
      trigRef.once('value').then(snapshot => {
        if (snapshot && typeof snapshot.exists === 'function' && snapshot.exists()) {
          const remoteTrigs = snapshot.val()
          if (Array.isArray(remoteTrigs)) {
            this._triggers = remoteTrigs
            this._saveLocalOnly()
            logger.info(`TriggerEngine: Hydrated ${remoteTrigs.length} triggers from Firebase.`)
          }
        } else if (this._triggers.length > 0) {
          this._syncRemote()
          logger.info('TriggerEngine: Seeded Firebase with initial local triggers.')
        }
      }).catch(err => {
        logger.warn(`TriggerEngine: Firebase initial sync warning: ${err.message}`)
      })
    } catch (err) {
      logger.warn(`TriggerEngine: Failed to setup Firebase sync: ${err.message}`)
    }
  }

  _syncRemote () {
    if (!this._database || typeof this._database.ref !== 'function') return
    if (this._syncTimer) clearTimeout(this._syncTimer)

    this._syncTimer = setTimeout(() => {
      try {
        this._database.ref('agent_triggers').set(this._triggers)
          .then(() => logger.debug('TriggerEngine: Successfully synced triggers to Firebase.'))
          .catch(e => logger.warn(`TriggerEngine: Firebase sync error: ${e.message}`))
      } catch (err) {
        logger.warn(`TriggerEngine: Failed to dispatch Firebase sync: ${err.message}`)
      }
    }, 500)
    if (this._syncTimer.unref) this._syncTimer.unref()
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

  _load () {
    try {
      if (typeof fs.existsSync === 'function' && fs.existsSync(TRIGGERS_FILE)) {
        if (typeof fs.readFileSync === 'function') {
          const raw = fs.readFileSync(TRIGGERS_FILE, 'utf8')
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            this._triggers = parsed
            return
          }
        }
      }
    } catch (err) {
      logger.warn(`TriggerEngine: Could not load triggers from disk: ${err.message}`)
    }
    this._triggers = []
  }

  _saveLocalOnly () {
    try {
      this._ensureDataDir()
      if (typeof fs.writeFileSync === 'function') {
        fs.writeFileSync(TRIGGERS_FILE, JSON.stringify(this._triggers, null, 2), 'utf8')
      }
    } catch (err) {
      logger.error(`TriggerEngine: Could not save triggers to disk: ${err.message}`)
    }
  }

  _save () {
    this._saveLocalOnly()
    this._syncRemote()
  }

  // ─── CRUD Operations ────────────────────────────────────────────────────────

  listTriggers () {
    return [...this._triggers]
  }

  addTrigger ({
    conditionType, // 'command_error_streak' | 'command_error_rate' | 'host_cpu' | 'host_ram' | 'bot_memory'
    target = null, // command name (e.g. 'netstats') or null
    threshold, // number (e.g. 3 consecutive errors, 85% RAM, 8.0 CPU load, 750 MB RSS)
    actionType = 'alert_owner', // 'alert_owner' | 'auto_heal' | 'auto_rollback' | 'auto_restart' | 'send_message'
    actionParams = {},
    cooldownMinutes = 15,
    description = ''
  }) {
    if (!conditionType) throw new Error('conditionType is required.')
    if (threshold === undefined || threshold === null) throw new Error('threshold is required.')

    const id = `trig_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    const newTrigger = {
      id,
      conditionType,
      target: target ? target.toLowerCase().trim().replace(/^\/+/, '') : null,
      threshold: Number(threshold),
      actionType,
      actionParams: actionParams || {},
      cooldownMinutes: Math.max(1, parseInt(cooldownMinutes) || 15),
      description: description || `${conditionType} (${target || 'system'}) threshold ${threshold}`,
      createdAt: new Date().toISOString(),
      enabled: true
    }

    this._triggers.push(newTrigger)
    this._save()
    logger.info(`TriggerEngine: Registered new trigger "${id}": ${newTrigger.description} -> ${actionType}`)
    return newTrigger
  }

  setTriggerEnabled (identifier, enabled = true) {
    const cleanId = String(identifier || '').toLowerCase().trim()
    const trigger = this._triggers.find(t =>
      t.id.toLowerCase() === cleanId ||
      t.conditionType.toLowerCase() === cleanId ||
      (t.target && t.target.toLowerCase() === cleanId) ||
      (t.description && t.description.toLowerCase().includes(cleanId))
    )

    if (!trigger) return null
    trigger.enabled = Boolean(enabled)
    this._save()
    logger.info(`TriggerEngine: Trigger "${trigger.id}" (${trigger.description}) enabled=${trigger.enabled}`)
    return trigger
  }

  deleteTrigger (identifier) {
    const cleanId = String(identifier || '').toLowerCase().trim()
    const index = this._triggers.findIndex(t =>
      t.id.toLowerCase() === cleanId ||
      t.conditionType.toLowerCase() === cleanId ||
      (t.target && t.target.toLowerCase() === cleanId) ||
      (t.description && t.description.toLowerCase().includes(cleanId))
    )

    if (index === -1) return false
    const removed = this._triggers.splice(index, 1)[0]
    this._save()
    logger.info(`TriggerEngine: Removed trigger "${removed.id}" (${removed.description})`)
    return true
  }

  // ─── Cooldown Check ─────────────────────────────────────────────────────────

  _isCooldownActive (triggerId, cooldownMinutes) {
    const lastFired = this._lastFired.get(triggerId)
    if (!lastFired) return false
    const cooldownMs = (cooldownMinutes || 15) * 60 * 1000
    return (Date.now() - lastFired) < cooldownMs
  }

  _recordFired (triggerId) {
    this._lastFired.set(triggerId, Date.now())
  }

  // ─── Evaluation Handlers ───────────────────────────────────────────────────

  /**
   * Evaluates command-level triggers immediately upon command completion.
   */
  async evaluateCommandExecution (record, client) {
    if (!record || !record.commandName) return
    const botClient = client || this.client
    const normalizedCmd = record.commandName.toLowerCase().replace(/^\/+/, '')

    const activeTriggers = this._triggers.filter(t =>
      t.enabled &&
      (t.conditionType === 'command_error_streak' || t.conditionType === 'command_error_rate') &&
      (!t.target || t.target === normalizedCmd)
    )

    for (const trigger of activeTriggers) {
      if (this._isCooldownActive(trigger.id, trigger.cooldownMinutes)) continue

      let tripped = false
      let tripContext = {}

      if (trigger.conditionType === 'command_error_streak') {
        const events = this._getRecentCommandEvents(trigger.target || normalizedCmd, trigger.threshold + 2)
        const recentErrors = []
        for (let i = events.length - 1; i >= 0; i--) {
          if (!events[i].success) {
            recentErrors.push(events[i])
          } else {
            break // streak broken by a success
          }
        }

        if (recentErrors.length >= trigger.threshold) {
          tripped = true
          tripContext = {
            streakCount: recentErrors.length,
            lastError: recentErrors[0]?.error,
            commandName: trigger.target || normalizedCmd
          }
        }
      } else if (trigger.conditionType === 'command_error_rate') {
        const sampleSize = 10
        const events = this._getRecentCommandEvents(trigger.target || normalizedCmd, sampleSize)
        if (events.length >= 3) {
          const failedCount = events.filter(e => !e.success).length
          const rate = (failedCount / events.length) * 100
          if (rate >= trigger.threshold) {
            tripped = true
            tripContext = {
              errorRate: `${rate.toFixed(1)}%`,
              sampleSize: events.length,
              commandName: trigger.target || normalizedCmd
            }
          }
        }
      }

      if (tripped) {
        this._recordFired(trigger.id)
        await this._dispatchTriggerAction(trigger, tripContext, botClient)
      }
    }
  }

  /**
   * Evaluates generic incoming webhook events from external services.
   */
  async evaluateWebhook (webhookId, payload, client) {
    const botClient = client || this.client
    const cleanId = String(webhookId || '').toLowerCase().trim()

    const activeTriggers = this._triggers.filter(t =>
      t.enabled &&
      t.conditionType === 'webhook' &&
      (!t.target || t.target.toLowerCase() === cleanId)
    )

    logger.info(`TriggerEngine: Processing incoming webhook "${cleanId}" (Matching triggers: ${activeTriggers.length})`)

    for (const trigger of activeTriggers) {
      if (this._isCooldownActive(trigger.id, trigger.cooldownMinutes)) continue

      this._recordFired(trigger.id)
      const context = {
        webhookId: cleanId,
        receivedAt: new Date().toISOString(),
        payload
      }
      await this._dispatchTriggerAction(trigger, context, botClient)
    }

    return { matched: activeTriggers.length }
  }

  /**
   * Periodic resource watchdog check.
   */
  async evaluateResourceMetrics (client) {
    const botClient = client || this.client
    const activeTriggers = this._triggers.filter(t =>
      t.enabled &&
      ['host_cpu', 'host_ram', 'bot_memory'].includes(t.conditionType)
    )

    if (activeTriggers.length === 0) return

    const load1m = os.loadavg()[0]
    const totalMem = os.totalmem()
    const usedMem = totalMem - os.freemem()
    const ramPercent = totalMem > 0 ? (usedMem / totalMem) * 100 : 0
    const rssMb = process.memoryUsage().rss / (1024 * 1024)

    for (const trigger of activeTriggers) {
      if (this._isCooldownActive(trigger.id, trigger.cooldownMinutes)) continue

      let tripped = false
      let tripContext = {}

      if (trigger.conditionType === 'host_cpu' && load1m >= trigger.threshold) {
        tripped = true
        tripContext = { metric: 'Host CPU Load (1m)', current: load1m.toFixed(2), threshold: trigger.threshold }
      } else if (trigger.conditionType === 'host_ram' && ramPercent >= trigger.threshold) {
        tripped = true
        tripContext = { metric: 'Host RAM Usage', current: `${ramPercent.toFixed(1)}%`, threshold: `${trigger.threshold}%` }
      } else if (trigger.conditionType === 'bot_memory' && rssMb >= trigger.threshold) {
        tripped = true
        tripContext = { metric: 'Bot Process RSS', current: `${rssMb.toFixed(1)} MB`, threshold: `${trigger.threshold} MB` }
      }

      if (tripped) {
        this._recordFired(trigger.id)
        await this._dispatchTriggerAction(trigger, tripContext, botClient)
      }
    }
  }

  startWatchdog (client, intervalMs = 60000) {
    this.client = client || this.client
    if (this._watchdogTimer) clearInterval(this._watchdogTimer)

    this._watchdogTimer = setInterval(() => {
      this.evaluateResourceMetrics(this.client).catch(err => {
        logger.warn(`TriggerEngine: Error during watchdog cycle: ${err.message}`)
      })
    }, intervalMs)

    if (this._watchdogTimer.unref) this._watchdogTimer.unref()
    logger.info(`TriggerEngine: Started periodic resource watchdog timer (${Math.round(intervalMs / 1000)}s interval).`)
  }

  stopWatchdog () {
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer)
      this._watchdogTimer = null
    }
  }

  // ─── Helper Queries ─────────────────────────────────────────────────────────

  _getRecentCommandEvents (commandName, limit = 10) {
    const telem = this.telemetry || require('./telemetry')
    const events = telem.events || []
    const normalized = (commandName || '').toLowerCase().replace(/^\/+/, '')

    return events
      .filter(e => !normalized || e.commandName === normalized)
      .slice(-limit)
  }

  // ─── Action Dispatcher ─────────────────────────────────────────────────────

  async _dispatchTriggerAction (trigger, context, client) {
    const ownerId = process.env.OWNER_ID
    const botClient = client || this.client

    logger.warn(`TriggerEngine: TRIGGER FIRED [${trigger.id}] "${trigger.description}" -> Action: ${trigger.actionType}`)

    if (trigger.actionType === 'alert_owner') {
      if (botClient && ownerId) {
        try {
          const owner = await botClient.users.fetch(ownerId).catch(() => null)
          if (owner) {
            const embed = {
              data: {
                title: `🚨 Watchdog Trigger Alert: ${trigger.description}`,
                color: 0xFF4500,
                description: 'A reactive watchdog trigger condition was satisfied.',
                fields: [
                  { name: 'Condition', value: `\`${trigger.conditionType}\` (Threshold: ${trigger.threshold})`, inline: true },
                  { name: 'Details', value: `\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`` }
                ],
                footer: { text: `Trigger ID: ${trigger.id} • Cooldown: ${trigger.cooldownMinutes}m` },
                timestamp: new Date().toISOString()
              }
            }

            await owner.send({ embeds: [embed] })
          }
        } catch (err) {
          logger.warn(`TriggerEngine: Failed to deliver owner alert embed: ${err.message}`)
        }
      }
      return
    }

    if (trigger.actionType === 'auto_heal') {
      const selfHealing = this.selfHealing || require('../util/chat/SelfHealingEngine')
      const cmdName = trigger.target || context.commandName
      if (cmdName) {
        logger.info(`TriggerEngine: Auto-dispatching self-healing repair proposal for command "${cmdName}"...`)
        await selfHealing.proposeSlashCommandFix({
          commandName: cmdName,
          error: new Error(context.lastError || `Repeated error streak (${context.streakCount} failures)`),
          client: botClient
        }).catch(e => logger.warn(`TriggerEngine: Auto-heal proposal failed: ${e.message}`))
      }
      return
    }

    if (trigger.actionType === 'auto_rollback') {
      const cmdName = trigger.target || context.commandName
      if (cmdName) {
        const latestBackupId = this._findLatestBackup('slash', cmdName)
        if (latestBackupId) {
          logger.warn(`TriggerEngine: Executing automated rollback for "/${cmdName}" to backup snapshot "${latestBackupId}"...`)
          const selfHealing = this.selfHealing || require('../util/chat/SelfHealingEngine')
          const rollbackRes = await selfHealing.rollbackRepair(latestBackupId, ownerId, botClient)

          if (botClient && ownerId) {
            const owner = await botClient.users.fetch(ownerId).catch(() => null)
            if (owner) {
              const msg = rollbackRes.success
                ? `⏪ **Automated Watchdog Rollback**: \`/${cmdName}\` breached error threshold (${context.streakCount || 'repeated'} errors). Automatically rolled back to snapshot \`${latestBackupId}\` and reloaded.`
                : `⚠️ **Automated Rollback Failed**: Attempted rollback for \`/${cmdName}\` but encountered error: ${rollbackRes.error}`
              await owner.send(msg).catch(() => {})
            }
          }
        } else {
          logger.warn(`TriggerEngine: Auto-rollback requested for "/${cmdName}", but no backup snapshot was found in ${BACKUPS_DIR}`)
        }
      }
      return
    }

    if (trigger.actionType === 'auto_restart') {
      logger.warn(`TriggerEngine: Initiating automated watchdog restart due to condition "${trigger.description}"...`)
      if (botClient && ownerId) {
        const owner = await botClient.users.fetch(ownerId).catch(() => null)
        if (owner) {
          await owner.send(`🔄 **Watchdog Auto-Restart**: Trigger "${trigger.description}" fired. Restarting Skynet service cleanly...`).catch(() => {})
        }
      }

      setTimeout(async () => {
        try {
          if (botClient?.destroy) await botClient.destroy()
        } catch (_) {}
        process.exit(0)
      }, 1000)
      return
    }

    if (trigger.actionType === 'send_message') {
      const channelId = trigger.actionParams?.channelId
      if (channelId && botClient) {
        try {
          const chan = await botClient.channels.fetch(channelId).catch(() => null)
          if (chan && typeof chan.send === 'function') {
            await chan.send(trigger.actionParams.message || `⚠️ **Watchdog Notice**: Condition \`${trigger.description}\` triggered.`)
          }
        } catch (err) {
          logger.warn(`TriggerEngine: Failed to send message to channel ${channelId}: ${err.message}`)
        }
      }
    }
  }

  _findLatestBackup (targetType, name) {
    try {
      if (!fs.existsSync(BACKUPS_DIR)) return null
      const files = fs.readdirSync(BACKUPS_DIR)
      const prefix = `bak_${targetType}_${name}_`
      const matching = files
        .filter(f => f.startsWith(prefix) && f.endsWith('.bak.js'))
        .sort()
        .reverse()

      if (matching.length > 0) {
        return matching[0].replace(/\.bak\.js$/, '')
      }
    } catch (_) {}
    return null
  }
}

module.exports = new TriggerEngine()
