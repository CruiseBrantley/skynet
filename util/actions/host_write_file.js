const fs = require('fs')
const path = require('path')
const os = require('os')

// Default home directory boundary
const HOME_DIR = process.env.OWNER_WORKSPACE_ROOT || os.homedir()

module.exports = {
  name: 'host_write_file',
  description: 'Owner-Only: Creates, writes, or overwrites a file on the local host within the owner workspace (~ or specified path).',
  ownerOnly: true,
  schema: {
    file_path: {
      type: 'string',
      description: 'Absolute or relative destination path (e.g. "~/Documents/notes.txt", "scripts/test.sh").'
    },
    content: {
      type: 'string',
      description: 'Text content to write into the file.'
    },
    append: {
      type: 'boolean',
      description: 'If true, append to existing file instead of overwriting.'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const rawPath = (params.file_path || '').trim()
    if (!rawPath) {
      return '[SYSTEM: Error: "file_path" parameter is required.]'
    }

    if (params.content === undefined || params.content === null) {
      return '[SYSTEM: Error: "content" parameter is required.]'
    }

    // Expand ~ to HOME_DIR
    const resolvedPath = rawPath.startsWith('~')
      ? path.join(HOME_DIR, rawPath.slice(1))
      : (path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath))

    // Disallow writing outside user home workspace unless explicitly configured
    if (!resolvedPath.startsWith(HOME_DIR) && !resolvedPath.startsWith(process.cwd())) {
      return `[SYSTEM: Error: Access Denied. Destination "${resolvedPath}" is outside allowed owner workspace root (${HOME_DIR}).]`
    }

    try {
      const parentDir = path.dirname(resolvedPath)
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true })
      }

      if (params.append) {
        fs.appendFileSync(resolvedPath, params.content, 'utf8')
        return `[SYSTEM: Successfully appended ${params.content.length} characters to "${resolvedPath}".]`
      } else {
        fs.writeFileSync(resolvedPath, params.content, 'utf8')
        return `[SYSTEM: Successfully wrote ${params.content.length} characters to "${resolvedPath}".]`
      }
    } catch (err) {
      return `[SYSTEM: Error writing to "${resolvedPath}": ${err.message}]`
    }
  }
}
