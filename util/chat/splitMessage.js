const { convertMarkdownTables } = require('../discordFormatter')

function splitMessage (text) {
  if (!text) return []
  const sanitizedText = convertMarkdownTables(text)
  const chunks = []
  let currentChunk = ''
  let inCodeBlock = false
  let codeBlockLang = ''

  const lines = sanitizedText.split('\n')
  for (const line of lines) {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      if (inCodeBlock) {
        codeBlockLang = line.replace(/```/g, '').trim()
      } else {
        codeBlockLang = ''
      }
    }

    // If adding this line exceeds the Discord limit (leaving room for code block closing wrappers)
    if (currentChunk.length + line.length > 1900) {
      if (inCodeBlock) {
        currentChunk += '\n```'
      }
      chunks.push(currentChunk)
      currentChunk = (inCodeBlock ? '```' + codeBlockLang + '\n' : '') + line + '\n'
    } else {
      currentChunk += line + '\n'
    }
  }
  if (currentChunk.trim().length > 0) {
    if (inCodeBlock) {
      currentChunk += '\n```'
    }
    chunks.push(currentChunk)
  }
  // Fallback for extreme single-line edge cases without breaking code blocks
  if (chunks.length === 0) {
    chunks.push(text.substring(0, 1990))
  }
  return chunks
}

module.exports = { splitMessage }
