const {
  convertMarkdownTables,
  demoteLargeHeaders,
  balanceMarkdownTags,
  smartTruncate,
  formatForEmbed,
  formatForMessage
} = require('../util/discordFormatter')

describe('discordFormatter', () => {
  describe('convertMarkdownTables', () => {
    test('converts simple markdown table into bullet list', () => {
      const table = '| Game | Status |\n|---|---|\n| Valheim | Active |\n| Core Keeper | Inactive |'
      const converted = convertMarkdownTables(table)
      expect(converted).toContain('- **Game**: Valheim | **Status**: Active')
      expect(converted).toContain('- **Game**: Core Keeper | **Status**: Inactive')
      expect(converted).not.toContain('|---|---|')
    })

    test('leaves regular text unchanged', () => {
      const text = 'Just a regular message without tables.'
      expect(convertMarkdownTables(text)).toBe(text)
    })
  })

  describe('demoteLargeHeaders', () => {
    test('replaces # and ## with ###', () => {
      const text = '# Main Header\n## Sub Header\n### Small Header'
      const formatted = demoteLargeHeaders(text)
      expect(formatted).toBe('### Main Header\n### Sub Header\n### Small Header')
    })
  })

  describe('balanceMarkdownTags', () => {
    test('closes unclosed code blocks', () => {
      const unclosed = 'Here is code:\n```javascript\nconst a = 1'
      expect(balanceMarkdownTags(unclosed)).toBe('Here is code:\n```javascript\nconst a = 1\n```')
    })

    test('closes unclosed bold tags', () => {
      const unclosed = 'This is **bold text'
      expect(balanceMarkdownTags(unclosed)).toBe('This is **bold text**')
    })
  })

  describe('smartTruncate', () => {
    test('truncates at sentence/newline boundary and balances tags', () => {
      const longText = 'First sentence with ```javascript\nconst a = 1234567890;\nconst b = 9876543210;\nand more text that goes on and on.'
      const truncated = smartTruncate(longText, 60)
      expect(truncated).toContain('*(Truncated for Discord limit)*')
      expect(truncated.endsWith('\n```') || truncated.endsWith('```')).toBe(true)
    })
  })

  describe('formatForEmbed & formatForMessage', () => {
    test('formats text cleanly for embeds and messages', () => {
      const input = '# Title\n| A | B |\n|---|---|\n| 1 | 2 |'
      const embedOutput = formatForEmbed(input)
      expect(embedOutput).toContain('### Title')
      expect(embedOutput).toContain('- **A**: 1 | **B**: 2')

      const messageOutput = formatForMessage(input)
      expect(messageOutput).toContain('- **A**: 1 | **B**: 2')
    })
  })
})
