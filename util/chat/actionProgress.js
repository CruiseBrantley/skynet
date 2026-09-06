/**
 * Formats tool names and arguments into human-readable Antigravity-style action labels.
 *
 * Example:
 *   read_system_file { file_path: "frontend/src/App.module.css" }
 *   -> active: "Reading frontend/src/App.module.css..."
 *   -> done: "Read frontend/src/App.module.css"
 */
function formatActionDescription (name, args = {}, status = 'active') {
  const toolName = (name || '').toLowerCase().trim().replace(/^\/+/, '')
  const isDone = status === 'done'
  const isError = status === 'error'

  let desc = ''
  switch (toolName) {
    case 'read_system_file': {
      const file = args.file_path || args.path || args.filename || 'file'
      desc = isDone ? `Read \`${file}\`` : `Reading \`${file}\`...`
      break
    }
    case 'write_system_file': {
      const file = args.file_path || args.path || args.filename || 'file'
      desc = isDone ? `Wrote \`${file}\`` : `Writing \`${file}\`...`
      break
    }
    case 'web_search': {
      const q = args.query || args.q || 'web'
      desc = isDone ? `Searched web for "${q}"` : `Searching web for "${q}"...`
      break
    }
    case 'fetch_web_content':
    case 'web_fetch': {
      const u = args.url || 'web page'
      desc = isDone ? `Fetched \`${u}\`` : `Fetching \`${u}\`...`
      break
    }
    case 'read_state': {
      const key = args.key || args.state_key || 'state'
      desc = isDone ? `Inspected state for \`${key}\`` : `Inspecting state for \`${key}\`...`
      break
    }
    case 'write_state': {
      const key = args.key || args.state_key || 'state'
      desc = isDone ? `Updated state for \`${key}\`` : `Updating state for \`${key}\`...`
      break
    }
    case 'remember': {
      const key = args.key || 'memory'
      desc = isDone ? `Stored memory for "${key}"` : `Storing memory for "${key}"...`
      break
    }
    case 'recall': {
      const key = args.key || 'memory'
      desc = isDone ? `Retrieved memory for "${key}"` : `Retrieving memory for "${key}"...`
      break
    }
    case 'forget': {
      const key = args.key || 'memory'
      desc = isDone ? `Cleared memory for "${key}"` : `Clearing memory for "${key}"...`
      break
    }
    case 'send_embed': {
      desc = isDone ? 'Published embed to channel' : 'Publishing embed...'
      break
    }
    case 'send_poll': {
      const question = args.question || 'poll'
      desc = isDone ? `Created poll "${question}"` : `Creating poll "${question}"...`
      break
    }
    case 'send_message': {
      desc = isDone ? 'Sent message to channel' : 'Sending message to channel...'
      break
    }
    case 'add_reaction': {
      const emoji = args.emoji || 'reaction'
      desc = isDone ? `Added reaction ${emoji}` : `Adding reaction ${emoji}...`
      break
    }
    case 'remove_reaction': {
      const emoji = args.emoji || 'reaction'
      desc = isDone ? `Removed reaction ${emoji}` : `Removing reaction ${emoji}...`
      break
    }
    case 'create_slash_command': {
      const name = args.name || 'command'
      desc = isDone ? `Created slash command \`/${name}\`` : `Creating slash command \`/${name}\`...`
      break
    }
    case 'read_dms': {
      desc = isDone ? 'Inspected direct messages' : 'Inspecting direct messages...'
      break
    }
    case 'list_channels': {
      desc = isDone ? 'Inspected server channels' : 'Inspecting server channels...'
      break
    }
    default: {
      const prettyName = toolName.replace(/_/g, ' ')
      desc = isDone ? `Completed ${prettyName}` : `Executing ${prettyName}...`
      break
    }
  }

  if (isError) {
    return `Failed: ${desc.replace(/\.\.\.$/, '')}`
  }
  return desc
}

/**
 * Tracks an ordered list of actions for an agent turn and renders
 * progressive markdown checklists suitable for Discord and Web chat.
 */
class ActionProgressTracker {
  constructor ({ botName = 'Skynet' } = {}) {
    this.botName = botName
    this.actions = []
  }

  /**
   * Records the start of a tool execution.
   */
  startAction (name, args) {
    const desc = formatActionDescription(name, args, 'active')
    const item = {
      name,
      args,
      status: 'active',
      desc,
      startTime: Date.now()
    }
    this.actions.push(item)
    return item
  }

  /**
   * Marks the current action as completed (success or error).
   */
  finishAction (name, success = true) {
    for (let i = this.actions.length - 1; i >= 0; i--) {
      if (this.actions[i].name === name && this.actions[i].status === 'active') {
        this.actions[i].status = success ? 'done' : 'error'
        this.actions[i].desc = formatActionDescription(name, this.actions[i].args, success ? 'done' : 'error')
        this.actions[i].endTime = Date.now()
        break
      }
    }
  }

  /**
   * Formats the checklist for Discord messages.
   *
   * Example:
   *   ✓ Read `frontend/src/App.module.css`
   *   • Searching web for "iOS Safari dvh bug"...
   */
  renderDiscordProgress () {
    if (this.actions.length === 0) {
      return `*${this.botName} is thinking...*`
    }

    const lines = this.actions.map(act => {
      if (act.status === 'done') {
        return `✓ ${act.desc}`
      } else if (act.status === 'error') {
        return `✗ ${act.desc}`
      } else {
        return `• ${act.desc}`
      }
    })

    return lines.join('\n')
  }

  /**
   * Returns the latest active action description or summary.
   */
  getLatestStatus () {
    if (this.actions.length === 0) {
      return `${this.botName} is thinking...`
    }
    const last = this.actions[this.actions.length - 1]
    return last.desc
  }

  /**
   * Alias for web status rendering.
   */
  renderWebStatus () {
    return this.getLatestStatus()
  }
}

module.exports = {
  formatActionDescription,
  ActionProgressTracker
}
