const chat = require('../commands/chat')

describe('Chat Unit Safety - Regex & Scrubbing', () => {
  test('COMMAND_REGEX should match valid JSON commands', () => {
    const text = 'Hello! <<<RUN_COMMAND: {"command": "test", "params": {"q": 1}}>>>'
    const match = text.match(chat.COMMAND_REGEX)
    expect(match).toBeTruthy()
    expect(match[1]).toContain('"command": "test"')
  })

  test('COMMAND_REGEX should handle multiline JSON', () => {
    const text = '<<<RUN_COMMAND: {\n  "command": "search",\n  "query": "test"\n}>>>'
    const match = text.match(chat.COMMAND_REGEX)
    expect(match).toBeTruthy()
    expect(match[1]).toContain('"query": "test"')
  })

  test('scrubTags should remove all RUN_COMMAND tags', () => {
    const text = 'Answer: 42. <<<RUN_COMMAND: {}>>>'
    const result = chat.scrubTags(text)
    expect(result).toBe('Answer: 42.')
  })

  test('scrubTags should handle multiple tags', () => {
    const text = '<<<RUN_COMMAND: {"a": 1}>>> Text <<<RUN_COMMAND: {"b": 2}>>>'
    const result = chat.scrubTags(text)
    expect(result).toBe('Text')
  })

  test('scrubTags should handle no tags', () => {
    const text = 'Plain text only.'
    const result = chat.scrubTags(text)
    expect(result).toBe('Plain text only.')
  })
})
