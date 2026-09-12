const { exec } = require('child_process')
const os = require('os')

// Default working directory
const DEFAULT_CWD = process.env.OWNER_WORKSPACE_ROOT || os.homedir()
const TIMEOUT_MS = 60000 // 60s timeout max

module.exports = {
  name: 'host_exec',
  description: 'Owner-Only: Executes a terminal / shell command directly on the host machine in zsh/bash. Returns stdout, stderr, and exit status.',
  ownerOnly: true,
  schema: {
    command: {
      type: 'string',
      description: 'The exact command line string to run (e.g. "git status", "ls -la", "node -v", "npm test").'
    },
    cwd: {
      type: 'string',
      description: 'Working directory for command execution (defaults to project root or ~).'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const rawCmd = (params.command || params.cmd || params.command_arg || '').trim()
    if (!rawCmd) {
      return '[SYSTEM: Error: "command" parameter is required.]'
    }

    const workingDir = (params.cwd || '').trim() || process.cwd() || DEFAULT_CWD

    return new Promise((resolve) => {
      exec(rawCmd, {
        cwd: workingDir,
        timeout: TIMEOUT_MS,
        maxBuffer: 1024 * 1024 * 2, // 2MB buffer
        shell: process.env.SHELL || '/bin/zsh'
      }, (error, stdout, stderr) => {
        const out = (stdout || '').trim()
        const err = (stderr || '').trim()
        const code = error ? (error.code ?? 1) : 0

        let result = `[HOST EXECUTION: exit code ${code}]\n`
        if (out) {
          result += `\nSTDOUT:\n\`\`\`\n${out.length > 3500 ? out.substring(0, 3450) + '\n... (truncated)' : out}\n\`\`\``
        }
        if (err) {
          result += `\nSTDERR:\n\`\`\`\n${err.length > 2000 ? err.substring(0, 1950) + '\n... (truncated)' : err}\n\`\`\``
        }
        if (!out && !err) {
          result += '\n(No output produced)'
        }

        resolve(result)
      })
    })
  }
}
