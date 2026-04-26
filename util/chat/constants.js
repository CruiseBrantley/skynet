const COMMAND_REGEX = /<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd]:\s*(\{[\s\S]*?\})\s*>>>/
const SCRUB_REGEX = /<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd]:[\s\S]*?>>>/gi
const THOUGHT_SCRUB_REGEX =
  /^(?:Thinking\.\.\.|Let me check\.\.\.|One moment\.\.\.|Searching\.\.\.|Analyzing\.\.\.|Polishing response\.\.\.|Finalizing\.\.\.)$|^>.*$/gm

module.exports = {
  COMMAND_REGEX,
  SCRUB_REGEX,
  THOUGHT_SCRUB_REGEX
}
