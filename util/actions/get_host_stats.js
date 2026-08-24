const os = require('os')
const fs = require('fs')

function formatBytes (bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}

function formatDuration (seconds) {
  const d = Math.floor(seconds / (3600 * 24))
  const h = Math.floor((seconds % (3600 * 24)) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const parts = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join(' ')
}

function getDiskStats () {
  try {
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync('/')
      const total = stats.blocks * stats.bsize
      const free = stats.bavail * stats.bsize
      const used = total - free
      const percent = total > 0 ? ((used / total) * 100).toFixed(1) : '0.0'
      return {
        total: formatBytes(total),
        free: formatBytes(free),
        used: formatBytes(used),
        percent: `${percent}%`
      }
    }
  } catch (_) {}
  return null
}

module.exports = {
  name: 'get_host_stats',
  description: 'Retrieves real-time host hardware metrics: CPU load, RAM usage, root disk space, host uptime, and bot process memory consumption.',
  schema: {},
  execute: async (bot, channel, params = {}, context = {}) => {
    const cpus = os.cpus() || []
    const cpuModel = cpus.length > 0 ? cpus[0].model.trim() : 'Unknown CPU'
    const cpuCores = cpus.length
    const loadAvg = os.loadavg().map(n => n.toFixed(2)) // 1m, 5m, 15m

    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    const memPercent = totalMem > 0 ? ((usedMem / totalMem) * 100).toFixed(1) : '0.0'

    const processMem = process.memoryUsage()
    const hostUptime = formatDuration(os.uptime())
    const processUptime = formatDuration(process.uptime())
    const diskStats = getDiskStats()

    let report = '🖥️ **Host System Diagnostics & Resource Metrics**\n\n'

    report += '**Processor (CPU):**\n'
    report += `• **Model**: ${cpuModel} (${cpuCores} cores, ${os.arch()})\n`
    report += `• **Load Averages**: \`${loadAvg[0]}\` (1m), \`${loadAvg[1]}\` (5m), \`${loadAvg[2]}\` (15m)\n\n`

    report += '**System Memory (RAM):**\n'
    report += `• **Used**: ${formatBytes(usedMem)} / ${formatBytes(totalMem)} (${memPercent}%)\n`
    report += `• **Free Available**: ${formatBytes(freeMem)}\n\n`

    if (diskStats) {
      report += '**Storage (Root Disk):**\n'
      report += `• **Used**: ${diskStats.used} / ${diskStats.total} (${diskStats.percent})\n`
      report += `• **Free Space**: ${diskStats.free}\n\n`
    }

    report += '**Skynet Bot Process:**\n'
    report += `• **Process RSS Memory**: ${formatBytes(processMem.rss)}\n`
    report += `• **Heap Used**: ${formatBytes(processMem.heapUsed)} / ${formatBytes(processMem.heapTotal)}\n`
    report += `• **Process Uptime**: ${processUptime} (Host Uptime: ${hostUptime})\n`
    report += `• **Node Runtime**: ${process.version} on ${os.type()} (${os.release()})`

    return `[SYSTEM: Host Diagnostic Report:\n${report}\n\nUse this data to analyze performance bottlenecks, lag, or host resources naturally.]`
  }
}
