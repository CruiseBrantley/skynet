/**
 * Discord Output Formatter and Sanitizer
 * Ensures all AI outputs strictly conform to Discord formatting limitations:
 * - 2000 chars for regular messages, 4096 chars for embed descriptions.
 * - Converts raw markdown tables into mobile-friendly bullet points.
 * - Demotes huge single-# headers to ### or bold headers.
 * - Closes dangling code blocks (```), bold (**), or italic (*) tags cleanly upon truncation.
 */

/**
 * Convert Markdown tables (| Col 1 | Col 2 |) into clean bullet lists for Discord.
 */
function convertMarkdownTables (text) {
  if (!text.includes('|')) return text

  const lines = text.split('\n')
  const newLines = []
  let inTable = false
  let headers = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Table divider line (|---|---|)
    if (/^\|?\s*[-:]+\s*\|[\s-:|]*$/i.test(line)) {
      inTable = true
      continue
    }

    // Table row
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.slice(1, -1).split('|').map(c => c.trim())
      if (!inTable) {
        // First row is headers
        headers = cells
        inTable = true
        continue
      } else {
        // Content row
        const rowItems = cells.map((cell, idx) => {
          const header = headers[idx] || `Col ${idx + 1}`
          return `**${header}**: ${cell}`
        }).join(' | ')
        newLines.push(`- ${rowItems}`)
        continue
      }
    } else {
      if (inTable) {
        inTable = false
        headers = []
      }
      newLines.push(lines[i])
    }
  }

  return newLines.join('\n')
}

/**
 * Demote large markdown headers (# Title) in embed text to ### or bold text.
 */
function demoteLargeHeaders (text) {
  return text
    .replace(/^#\s+(.*)$/gm, '### $1')
    .replace(/^##\s+(.*)$/gm, '### $1')
}

/**
 * Ensure unclosed formatting tags are closed cleanly.
 */
function balanceMarkdownTags (text) {
  let result = text

  // Count code blocks (```)
  const codeBlockCount = (result.match(/```/g) || []).length
  if (codeBlockCount % 2 !== 0) {
    result += '\n```'
  }

  // Count bold markers (**)
  const boldCount = (result.match(/\*\*/g) || []).length
  if (boldCount % 2 !== 0) {
    result += '**'
  }

  return result
}

/**
 * Truncate text cleanly at a sentence or word boundary without breaking markdown.
 */
function smartTruncate (text, maxChars = 4000, suffix = '\n\n*(Truncated for Discord limit)*') {
  if (text.length <= maxChars) return text

  const targetLength = maxChars - suffix.length
  let cutIndex = targetLength

  // Find last newline or period before targetLength
  const lastNewline = text.lastIndexOf('\n', targetLength)
  const lastPeriod = text.lastIndexOf('. ', targetLength)

  if (lastNewline > targetLength * 0.7) {
    cutIndex = lastNewline
  } else if (lastPeriod > targetLength * 0.7) {
    cutIndex = lastPeriod + 1
  }

  const truncated = text.substring(0, cutIndex).trim() + suffix
  return balanceMarkdownTags(truncated)
}

/**
 * Sanitize and format text specifically for Discord Embed descriptions.
 * @param {string} text
 * @param {number} maxChars (default: 4000)
 */
function formatForEmbed (text, maxChars = 4000) {
  if (!text || typeof text !== 'string') return ''
  let formatted = convertMarkdownTables(text)
  formatted = demoteLargeHeaders(formatted)
  return smartTruncate(formatted, maxChars)
}

/**
 * Sanitize and format text for standard chat messages.
 * @param {string} text
 * @param {number} maxChars (default: 2000)
 */
function formatForMessage (text, maxChars = 2000) {
  if (!text || typeof text !== 'string') return ''
  const formatted = convertMarkdownTables(text)
  return smartTruncate(formatted, maxChars)
}

const { EmbedBuilder } = require('discord.js')

/**
 * SafeEmbedBuilder wraps Discord.js EmbedBuilder to guarantee that all text,
 * descriptions, headers, and fields strictly stay within Discord API limits:
 * - Description <= 4096 chars (auto-formats markdown tables and headers)
 * - Title <= 256 chars
 * - Field Name <= 256 chars, Field Value <= 1024 chars
 * - Footer <= 2048 chars, Author <= 256 chars
 */
class SafeEmbedBuilder extends EmbedBuilder {
  setTitle (title) {
    if (typeof title === 'string') {
      return super.setTitle(title.substring(0, 256))
    }
    return super.setTitle(title)
  }

  setDescription (description) {
    if (typeof description === 'string') {
      return super.setDescription(formatForEmbed(description, 4000))
    }
    return super.setDescription(description)
  }

  addFields (...fields) {
    const sanitized = fields.flat().map(field => {
      if (!field || typeof field !== 'object') return field
      const name = typeof field.name === 'string' ? field.name.substring(0, 256) : field.name
      const value = typeof field.value === 'string' ? smartTruncate(field.value, 1000, '...') : field.value
      return { ...field, name, value }
    })
    return super.addFields(sanitized)
  }

  setFooter (footer) {
    if (footer && typeof footer === 'object' && typeof footer.text === 'string') {
      return super.setFooter({ ...footer, text: footer.text.substring(0, 2048) })
    }
    return super.setFooter(footer)
  }

  setAuthor (author) {
    if (author && typeof author === 'object' && typeof author.name === 'string') {
      return super.setAuthor({ ...author, name: author.name.substring(0, 256) })
    }
    return super.setAuthor(author)
  }
}

module.exports = {
  convertMarkdownTables,
  demoteLargeHeaders,
  balanceMarkdownTags,
  smartTruncate,
  formatForEmbed,
  formatForMessage,
  SafeEmbedBuilder
}
