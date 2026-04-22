const { SCRUB_REGEX } = require('./constants');

function scrubTags(text) {
  if (!text) return text;
  return text.replace(SCRUB_REGEX, '').trim();
}

module.exports = { scrubTags };

