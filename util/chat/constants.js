const COMMAND_REGEX = /<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd]:\s*(\{[\s\S]*?\})\s*>>>/
const SCRUB_REGEX = /<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd]:[\s\S]*?>>>/gi
const THOUGHT_SCRUB_REGEX =
  /^(?:Thinking\.\.\.|Let me check\.\.\.|One moment\.\.\.|Searching\.\.\.|Analyzing\.\.\.|Polishing response\.\.\.|Finalizing\.\.\.)$|^>\s*(?:\*+)?(?:Thinking\.\.\.|Thought:?|Let me check\.\.\.|Searching\.\.\.|Analyzing\.\.\.|Polishing response\.\.\.|Finalizing\.\.\.).*$/gmi
const BOILERPLATE_SCRUB_REGEX =
  /I am (?:a |an )?[\s\S]*?developed by Google[\s\S]*?\.|How may I assist you today\?|As a large language model[\s\S]*?\.|<<<[\s\S]*?>>>/gi
const ID_SCRUB_REGEX = /^\[ID: \d+\]\s*@[\w\d._-]+(?:\s*\([^)]+\))?:\s*/gm

const MUTATION_TOOLS = new Set([
  'create_slash_command',
  'deploy_slash_commands',
  'manage_command',
  'manage_triggers',
  'manage_workflows',
  'write_state',
  'schedule_task',
  'cancel_task',
  'update_task',
  'send_embed',
  'send_message',
  'send_poll',
  'send_thread',
  'send_gif',
  'add_reaction',
  'remove_reaction',
  'remember',
  'forget'
])

module.exports = {
  COMMAND_REGEX,
  SCRUB_REGEX,
  THOUGHT_SCRUB_REGEX,
  BOILERPLATE_SCRUB_REGEX,
  ID_SCRUB_REGEX,
  MUTATION_TOOLS
}
