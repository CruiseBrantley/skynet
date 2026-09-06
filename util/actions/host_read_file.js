const fs = require('fs')
const path = require('path')
const os = require('os')

// Default home directory boundary
const HOME_DIR = process.env.OWNER_WORKSPACE_ROOT || os.homedir()

// Sensitive files that should never be dumped completely without explicit flags
const BLOCKED_FILE_PATTERNS = [
  /\/id_rsa$/i,
  /\/id_ed25519$/i,
  /\.pem$/i,
  /\.key$/i,
  /\/secrets\.json$/i
]

module.exports = {
  name: 'host_read_file',
  description: 'Owner-Only: Reads the contents of any file on the local host within the owner workspace (~ or specified path). Supports line offsets and limits.',
  ownerOnly: true,
  schema: {
    file_path: {
      type: 'string',
      description: 'Absolute or relative path to the file (e.g. "~/Documents/notes.txt", "/Users/cruise/git/skynet/package.json", "server/server.js").'
    },
    start_line: {
      type: 'integer',
      description: 'Optional 1-indexed starting line to read.'
    },
    line_count: {
      type: 'integer',
      description: 'Optional number of lines to read (default: 100, max: 500).'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const rawPath = (params.file_path || '').trim()
    if (!rawPath) {
      return '[SYSTEM: Error: "file_path" parameter is required.]'
    }

    // Expand ~ to HOME_DIR
    const resolvedPath = rawPath.startsWith('~')
      ? path.join(HOME_DIR, rawPath.slice(1))
      : (path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath))

    // Disallow reading outside user home workspace unless explicitly configured
    if (!resolvedPath.startsWith(HOME_DIR) && !resolvedPath.startsWith(process.cwd())) {
      return `[SYSTEM: Error: Access Denied. Path "${resolvedPath}" is outside allowed owner workspace root (${HOME_DIR}).]`
    }

    // Guard private certificates/keys
    if (BLOCKED_FILE_PATTERNS.some(re => re.test(resolvedPath))) {
      return `[SYSTEM: Error: Access to sensitive key/credential file "${resolvedPath}" is blocked by security policy.]`
    }

    if (!fs.existsSync(resolvedPath)) {
      return `[SYSTEM: File "${resolvedPath}" does not exist.]`
    }

    try {
      const stats = fs.statSync(resolvedPath)
      if (stats.isDirectory()) {
        const files = fs.readdirSync(resolvedPath).slice(0, 50)
        return `[SYSTEM: Directory listing for "${resolvedPath}" (${files.length} items)]:\n` + files.join('\n')
      }

      const raw = fs.readFileSync(resolvedPath, 'utf8')
      const lines = raw.split('\n')

      const start = params.start_line ? Math.max(1, parseInt(params.start_line, 10)) : 1
      const count = params.line_count ? Math.min(500, Math.max(1, parseInt(params.line_count, 10))) : 100

      const slice = lines.slice(start - 1, start - 1 + count)
      const numbered = slice.map((line, idx) => `${start + idx}: ${line}`).join('\n')

      return `[SYSTEM: Contents of "${resolvedPath}" (Lines ${start}-${start + slice.length - 1} of ${lines.length})]:\n\`\`\`\n${numbered}\n\`\`\``
    } catch (err) {
      return `[SYSTEM: Error reading file "${resolvedPath}": ${err.message}]`
    }
  }
}
