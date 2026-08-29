const fs = require('fs')
const path = require('path')

const ROOT_DIR = path.resolve(__dirname, '../../')

// Sensitive key patterns to redact in .env files
const SENSITIVE_KEY_REGEX = /(TOKEN|SECRET|KEY|PASSWORD|PASS|AUTH|CREDENTIAL|WEBHOOK|PRIVATE)/i
const NON_SENSITIVE_ENV_KEYS = new Set([
  'CLIENT_ID',
  'GUILD_ID',
  'OWNER_ID',
  'NODE_ENV',
  'PORT',
  'OLLAMA_HOST',
  'OLLAMA_MODEL',
  'LOCAL_OLLAMA_HOST',
  'TIMEZONE',
  'LOG_LEVEL'
])

function isPathWhitelisted (relativeFilePath) {
  const normalized = relativeFilePath.replace(/\\/g, '/').replace(/^\/+/, '')

  if (normalized.includes('..')) {
    return false
  }

  if (normalized.startsWith('node_modules/') || normalized.startsWith('.git/') || normalized.startsWith('coverage/')) {
    return false
  }

  if (normalized === '.env' || normalized === '.env.example' || normalized === 'package.json' || normalized === 'README.md' || normalized === 'AGENTS.md') {
    return true
  }

  if (normalized.startsWith('config/') || normalized.startsWith('data/') || normalized.startsWith('docs/')) {
    return true
  }

  if (normalized.startsWith('logs/') && normalized.endsWith('.log')) {
    return true
  }

  if (normalized.endsWith('.js') || normalized.endsWith('.json') || normalized.endsWith('.md')) {
    return true
  }

  return false
}

function sanitizeEnvContent (rawEnv) {
  const lines = rawEnv.split('\n')
  const sanitizedLines = lines.map(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return line

    const eqIndex = line.indexOf('=')
    if (eqIndex === -1) return line

    const key = line.substring(0, eqIndex).trim()
    const val = line.substring(eqIndex + 1).trim()

    if (NON_SENSITIVE_ENV_KEYS.has(key)) {
      return `${key}=${val}`
    }

    if (SENSITIVE_KEY_REGEX.test(key)) {
      if (!val) return `${key}=`
      return `${key}=[REDACTED_SECRET: ${val.length} chars]`
    }

    return line
  })

  return sanitizedLines.join('\n')
}

module.exports = {
  name: 'read_system_file',
  description: 'Reads and inspects codebase logic files (util/*, commands/*, routes/*), configuration files (config/*), environment definitions (.env with secrets redacted), or tails recent log files.',
  schema: {
    file_path: {
      type: 'string',
      description: 'Relative path to inspect (e.g. "util/twitch_notify.js", "commands/announcements.js", "config/announcements.json", "logs/combined.log", ".env").'
    },
    lines: {
      type: 'integer',
      description: 'Number of recent lines to tail for log files (default: 40, max: 100).'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const rawPath = (params.file_path || '').trim()
    if (!rawPath) {
      return '[SYSTEM: Error: "file_path" parameter is required.]'
    }

    const fullPath = path.resolve(ROOT_DIR, rawPath)
    const relativePath = path.relative(ROOT_DIR, fullPath)

    // Security Gate 1: Check root boundary traversal
    if (relativePath.startsWith('..') || path.isAbsolute(rawPath)) {
      return '[SYSTEM: Error: Access Denied. Path traversal outside project root is strictly forbidden.]'
    }

    // Security Gate 2: Check strict whitelist
    if (!isPathWhitelisted(relativePath)) {
      return `[SYSTEM: Error: Access Denied. "${relativePath}" is not in the allowed file whitelist (allowed: util/*.js, commands/*.js, routes/*.js, config/*, logs/*.log, data/*.json, .env, package.json, README.md, AGENTS.md).]`
    }

    if (!fs.existsSync(fullPath)) {
      return `[SYSTEM: File "${relativePath}" does not exist.]`
    }

    try {
      const stats = fs.statSync(fullPath)
      const isLog = relativePath.startsWith('logs/') || relativePath.endsWith('.log')
      const isEnv = relativePath === '.env' || relativePath.endsWith('.env')

      if (isLog) {
        const raw = fs.readFileSync(fullPath, 'utf8')
        const maxLines = Math.min(100, Math.max(5, parseInt(params.lines) || 40))
        const allLines = raw.split('\n')
        const tail = allLines.slice(-maxLines).join('\n')
        return `[SYSTEM: Log Tail for "${relativePath}" (Latest ${Math.min(allLines.length, maxLines)} of ${allLines.length} lines, ${(stats.size / 1024).toFixed(1)} KB):\n\`\`\`text\n${tail}\n\`\`\`]`
      }

      if (isEnv) {
        const raw = fs.readFileSync(fullPath, 'utf8')
        const sanitized = sanitizeEnvContent(raw)
        return `[SYSTEM: Environment Configuration for "${relativePath}" (Secrets Redacted):\n\`\`\`bash\n${sanitized}\n\`\`\`]`
      }

      const content = fs.readFileSync(fullPath, 'utf8')
      const ext = path.extname(fullPath).replace(/^\./, '') || 'text'
      return `[SYSTEM: File Content for "${relativePath}" (${(stats.size / 1024).toFixed(1)} KB):\n\`\`\`${ext}\n${content}\n\`\`\`]`
    } catch (err) {
      return `[SYSTEM: Error reading file "${relativePath}": ${err.message}]`
    }
  }
}
