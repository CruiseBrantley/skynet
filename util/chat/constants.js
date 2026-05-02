const COMMAND_REGEX = /<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd]:\s*(\{[\s\S]*?\})\s*>>>/
const SCRUB_REGEX = /<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd]:[\s\S]*?>>>/gi
const THOUGHT_SCRUB_REGEX =
  /^(?:Thinking\.\.\.|Let me check\.\.\.|One moment\.\.\.|Searching\.\.\.|Analyzing\.\.\.|Polishing response\.\.\.|Finalizing\.\.\.)$|^>.*$/gm
const BOILERPLATE_SCRUB_REGEX =
  /I am (?:a |an )?[\s\S]*?developed by Google[\s\S]*?\.|How may I assist you today\?|As a large language model[\s\S]*?\.|<<<[\s\S]*?>>>/gi
const ID_SCRUB_REGEX = /^\[ID: \d+\]\s*@[\w\d._-]+(?:\s*\([^)]+\))?:\s*/gm

module.exports = {
  COMMAND_REGEX,
  SCRUB_REGEX,
  THOUGHT_SCRUB_REGEX,
  BOILERPLATE_SCRUB_REGEX,
  ID_SCRUB_REGEX
}
