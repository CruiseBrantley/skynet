const fs = require('fs')
const path = require('path')
const logger = require('../logger')

const TELEMETRY_DIR = path.join(__dirname, '../data')
const TELEMETRY_FILE = path.join(TELEMETRY_DIR, 'telemetry_commands.json')
const MAX_EVENTS = 1000 // Ring buffer limit (keeps file under ~150KB)
const RETENTION_DAYS = 30 // Discard events older than 30 days

class TelemetryEngine {
  constructor () {
    this.events = []
    this._loadLocal()
  }

  init () {
    this._loadLocal()
  }

  _pruneOldEvents () {
    const cutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000)
    this.events = this.events.filter(e => (e.epoch || new Date(e.timestamp).getTime()) >= cutoff)
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS)
    }
  }

  _loadLocal () {
    try {
      if (!fs.existsSync(TELEMETRY_DIR)) {
        fs.mkdirSync(TELEMETRY_DIR, { recursive: true })
      }
      if (fs.existsSync(TELEMETRY_FILE)) {
        const raw = fs.readFileSync(TELEMETRY_FILE, 'utf8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          this.events = parsed
          this._pruneOldEvents()
        }
      }
    } catch (err) {
      logger.warn(`TelemetryEngine: Could not load local telemetry file: ${err.message}`)
      this.events = []
    }
  }

  _persistLocal () {
    try {
      if (!fs.existsSync(TELEMETRY_DIR)) {
        fs.mkdirSync(TELEMETRY_DIR, { recursive: true })
      }
      this._pruneOldEvents()
      fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(this.events, null, 2), 'utf8')
    } catch (err) {
      logger.warn(`TelemetryEngine: Could not persist local telemetry: ${err.message}`)
    }
  }

  /**
   * Track a command or action execution.
   */
  async trackCommandExecution ({
    commandName,
    type = 'slash', // 'slash' | 'autonomous' | 'action'
    guildId = 'DM',
    guildName = 'Direct Message',
    channelId = null,
    userId = 'unknown',
    username = 'unknown',
    success = true,
    error = null,
    durationMs = 0
  }) {
    if (!commandName) return

    const normalizedCmd = String(commandName).trim().replace(/^\/+/, '').toLowerCase()
    const now = new Date()
    const record = {
      id: `tel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      commandName: normalizedCmd,
      type,
      guildId: guildId || 'DM',
      guildName: guildName || (guildId === 'DM' ? 'Direct Message' : 'Unknown Server'),
      channelId,
      userId,
      username,
      success: Boolean(success),
      error: error ? (error.message || String(error)) : null,
      durationMs: Math.max(0, parseInt(durationMs) || 0),
      timestamp: now.toISOString(),
      epoch: now.getTime()
    }

    this.events.push(record)
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS)
    }

    this._persistLocal()

    try {
      const triggerEngine = require('./TriggerEngine')
      triggerEngine.evaluateCommandExecution(record).catch(e => {
        logger.debug(`TelemetryEngine: TriggerEngine evaluation error: ${e.message}`)
      })
    } catch (_) {}

    logger.debug(`TelemetryEngine: Logged ${type} invocation of /${normalizedCmd} by ${username} (${success ? 'SUCCESS' : 'ERROR'})`)
    return record
  }

  /**
   * Retrieve aggregate command statistics.
   * @param {object} [options]
   * @param {number} [options.timeframeHours] - Filter by hours (default 168 = 7 days, 0 = all time)
   * @param {string} [options.guildId] - Filter by specific guild ID
   * @param {string} [options.commandName] - Filter by specific command name
   * @param {number} [options.limit] - Limit list lengths
   * @returns {object} Aggregated statistics
   */
  getStats ({ timeframeHours = 168, guildId = null, commandName = null, limit = 10 } = {}) {
    const now = Date.now()
    const cutoff = (timeframeHours && timeframeHours > 0) ? (now - (timeframeHours * 60 * 60 * 1000)) : 0

    const filtered = this.events.filter(e => {
      if (cutoff > 0 && (e.epoch || new Date(e.timestamp).getTime()) < cutoff) return false
      if (guildId && e.guildId !== guildId) return false
      if (commandName && e.commandName !== commandName.toLowerCase()) return false
      return true
    })

    const totalInvocations = filtered.length
    let successCount = 0
    let errorCount = 0
    const commandCounts = {}
    const guildCounts = {}
    const userCounts = {}
    const typeCounts = {}
    const recentErrors = []

    for (const e of filtered) {
      if (e.success) {
        successCount++
      } else {
        errorCount++
        if (recentErrors.length < 5) {
          recentErrors.push({
            command: e.commandName,
            error: e.error,
            timestamp: e.timestamp,
            user: e.username,
            guild: e.guildName
          })
        }
      }

      // Command breakdown
      commandCounts[e.commandName] = (commandCounts[e.commandName] || 0) + 1

      // Type breakdown
      const typeKey = e.type || 'slash'
      typeCounts[typeKey] = (typeCounts[typeKey] || 0) + 1

      // Guild breakdown
      const gId = e.guildId || 'DM'
      if (!guildCounts[gId]) {
        guildCounts[gId] = { name: e.guildName || gId, count: 0 }
      }
      guildCounts[gId].count++

      // User breakdown
      const uId = e.userId || 'unknown'
      if (!userCounts[uId]) {
        userCounts[uId] = { username: e.username || uId, count: 0 }
      }
      userCounts[uId].count++
    }

    // Sort breakdowns
    const topCommands = Object.entries(commandCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)

    const topGuilds = Object.values(guildCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)

    const topUsers = Object.values(userCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)

    const errorRate = totalInvocations > 0 ? ((errorCount / totalInvocations) * 100).toFixed(1) + '%' : '0.0%'

    let timeframeLabel = 'All Time'
    if (timeframeHours > 0) {
      if (timeframeHours === 24) timeframeLabel = 'Past 24 Hours'
      else if (timeframeHours === 168) timeframeLabel = 'Past 7 Days'
      else if (timeframeHours === 720) timeframeLabel = 'Past 30 Days'
      else timeframeLabel = `Past ${timeframeHours} Hours`
    }

    return {
      timeframe: timeframeLabel,
      totalInvocations,
      successCount,
      errorCount,
      errorRate,
      topCommands,
      topGuilds,
      topUsers,
      byType: typeCounts,
      recentErrors
    }
  }

  /**
   * Format stats into a concise markdown text summary for chat/AI output.
   */
  formatStatsSummary (stats) {
    if (!stats || stats.totalInvocations === 0) {
      return `📊 **Command Usage Statistics (${stats?.timeframe || 'All Time'})**:\nNo command invocations recorded in this timeframe.`
    }

    const commandList = stats.topCommands
      .map(c => `• \`/${c.name}\`: **${c.count}**`)
      .join('\n')

    const guildList = stats.topGuilds
      .map(g => `• **${g.name}**: ${g.count}`)
      .join('\n')

    const userList = stats.topUsers
      .map(u => `• **${u.username}**: ${u.count}`)
      .join('\n')

    let summary = `📊 **Command Telemetry (${stats.timeframe})**\n`
    summary += `• **Total Invocations**: ${stats.totalInvocations} (${stats.successCount} success, ${stats.errorCount} failed — ${stats.errorRate} error rate)\n\n`
    summary += `**Top Commands:**\n${commandList || 'None'}\n\n`
    summary += `**Active Servers:**\n${guildList || 'None'}\n\n`
    summary += `**Top Users:**\n${userList || 'None'}`

    if (stats.recentErrors.length > 0) {
      const errList = stats.recentErrors.map(e => `• \`/${e.command}\` (${e.guild}): ${e.error}`).join('\n')
      summary += `\n\n⚠️ **Recent Failures:**\n${errList}`
    }

    return summary
  }

  /**
   * Retrieve recent execution events with filtering.
   * @param {object} [options]
   * @param {number} [options.limit] - Max events to return (default 15)
   * @param {string} [options.status] - 'all' | 'error' | 'success'
   * @param {string} [options.commandName] - Specific command filter
   * @param {string} [options.guildId] - Specific guild filter
   * @returns {Array<object>} Filtered events list in reverse chronological order
   */
  getRecentLogs ({ limit = 15, status = 'all', commandName = null, guildId = null } = {}) {
    const lim = Math.max(1, Math.min(50, parseInt(limit) || 15))
    const statusFilter = (status || 'all').toLowerCase()
    const targetCmd = commandName ? commandName.toLowerCase().replace(/^\/+/, '') : null

    const filtered = this.events.filter(e => {
      if (statusFilter === 'error' && e.success) return false
      if (statusFilter === 'success' && !e.success) return false
      if (targetCmd && e.commandName !== targetCmd) return false
      if (guildId && e.guildId !== guildId) return false
      return true
    })

    // Return newest first
    return filtered.slice(-lim).reverse()
  }

  /**
   * Format recent logs into a clear, readable text feed for the LLM / user.
   */
  formatRecentLogsSummary (logs, { status = 'all', commandName = null } = {}) {
    if (!logs || logs.length === 0) {
      const filterDesc = commandName ? ` for command "/${commandName}"` : ''
      const statusDesc = status !== 'all' ? ` with status "${status}"` : ''
      return `📋 **Recent Execution Logs**: No matching executions found${filterDesc}${statusDesc}.`
    }

    let out = `📋 **Recent Command Execution Feed (Latest ${logs.length})**:\n`
    for (const log of logs) {
      const statusEmoji = log.success ? '✅' : '❌'
      const statusText = log.success ? 'SUCCESS' : 'ERROR'
      const timeStr = new Date(log.timestamp).toLocaleTimeString()
      const dateStr = new Date(log.timestamp).toLocaleDateString()
      out += `${statusEmoji} **[${dateStr} ${timeStr}]** \`/${log.commandName}\` (${log.type}) — **${statusText}**\n`
      out += `   • **User**: ${log.username} | **Server**: ${log.guildName} | **Duration**: ${log.durationMs}ms\n`
      if (!log.success && log.error) {
        out += `   • **Error**: \`${log.error.substring(0, 300)}\`\n`
      }
    }
    return out
  }
}

module.exports = new TelemetryEngine()
