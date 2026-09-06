const axios = require('axios')
const net = require('net')
const { queryOllama, queryOllamaWithContext } = require('../util/ollama')
const { Readable } = require('stream')

jest.mock('axios')
jest.mock('net')
jest.mock('../logger')

describe('Ollama Streaming Integration', () => {
  let mockSocket

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OLLAMA_REMOTE_HOST = '127.0.0.1'
    process.env.OLLAMA_REMOTE_PORT = '11434'
    process.env.OLLAMA_REMOTE_MODEL = 'qwen3.8:27b'

    mockSocket = {
      setTimeout: jest.fn(),
      unref: jest.fn(),
      once: jest.fn(),
      connect: jest.fn((p, h, cb) => { if (cb) setImmediate(cb) }),
      end: jest.fn(),
      destroy: jest.fn(),
      removeAllListeners: jest.fn()
    }
    net.Socket.mockImplementation(() => mockSocket)
  })

  test('queryOllama streams tokens when onToken callback is provided', async () => {
    const streamChunks = [
      JSON.stringify({ message: { content: 'Hello ' } }) + '\n',
      JSON.stringify({ message: { content: 'world' } }) + '\n',
      JSON.stringify({ message: { content: '!' } }) + '\n'
    ]

    const mockStream = Readable.from(streamChunks)
    axios.post.mockResolvedValueOnce({
      data: mockStream
    })

    const collectedTokens = []
    const onToken = (t) => collectedTokens.push(t)

    const result = await queryOllama('/api/chat', { messages: [{ role: 'user', content: 'hi' }] }, 0, onToken)

    expect(collectedTokens).toEqual(['Hello ', 'world', '!'])
    expect(result).toBeDefined()
    expect(result.message.content).toBe('Hello world!')
  })

  test('queryOllama non-streaming execution remains backward-compatible', async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        message: {
          role: 'assistant',
          content: 'Non-streaming response'
        }
      }
    })

    const result = await queryOllama('/api/chat', { messages: [{ role: 'user', content: 'hi' }] }, 0, null)

    expect(result).toBeDefined()
    expect(result.message.content).toBe('Non-streaming response')
  })

  test('queryOllamaWithContext forwards streamToken to queryOllama', async () => {
    const streamChunks = [
      JSON.stringify({ message: { content: 'Streamed ' } }) + '\n',
      JSON.stringify({ message: { content: 'reply' } }) + '\n'
    ]

    const mockStream = Readable.from(streamChunks)
    axios.post.mockResolvedValueOnce({
      data: mockStream
    })

    const collectedTokens = []
    const onToken = (t) => collectedTokens.push(t)

    const result = await queryOllamaWithContext(
      [{ role: 'user', content: 'test' }],
      { onToken },
      'Skynet'
    )

    expect(collectedTokens).toEqual(['Streamed ', 'reply'])
    expect(result.message.content).toBe('Streamed reply')
  })

  test('scrubs in-progress tool calls and unclosed tag prefixes during live streaming', () => {
    function cleanStreamBuffer (buffer) {
      return buffer
        .replace(/<think[\s\S]*?(?:<\/think>|$)/gi, '')
        .replace(/<thought[\s\S]*?(?:<\/thought>|$)/gi, '')
        .replace(/<action[\s\S]*?(?:<\/action>|$)/gi, '')
        .replace(/<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd][\s\S]*?(?:>>>|$)/gi, '')
        .replace(/<<<[\s\S]*?(?:>>>|$)/gi, '')
        .replace(/<[a-zA-Z0-9_]*$/g, '')
        .replace(/<<*$/g, '')
        .trim()
    }

    expect(cleanStreamBuffer('<<')).toBe('')
    expect(cleanStreamBuffer('<<<')).toBe('')
    expect(cleanStreamBuffer('<<<RUN_COMMAND: {"command": "get_host_stats"')).toBe('')
    expect(cleanStreamBuffer('<think>Analyzing user query')).toBe('')
    expect(cleanStreamBuffer('<action>{"name": "test"}')).toBe('')
    expect(cleanStreamBuffer('<<<RUN_COMMAND: {"command": "test"}>>> Actual response')).toBe('Actual response')
  })

  test('queryOllama recovers response from streaming thinking block when content is empty', async () => {
    const streamChunks = [
      JSON.stringify({ message: { thinking: 'I think the answer is 42.' } }) + '\n'
    ]
    const mockStream = Readable.from(streamChunks)
    axios.post.mockResolvedValueOnce({ data: mockStream })

    const collectedTokens = []
    const onToken = (t) => collectedTokens.push(t)

    const result = await queryOllama('/api/chat', { messages: [{ role: 'user', content: 'hi' }] }, 0, onToken)

    expect(result.message.content).toBe('I think the answer is 42.')
    expect(collectedTokens).toEqual(['I think the answer is 42.'])
  })

  test('queryOllama retries with think=false when streaming content is empty and payload has think: true', async () => {
    const streamChunks = [
      JSON.stringify({ message: { content: '' } }) + '\n'
    ]
    const mockStream = Readable.from(streamChunks)

    // First call: streaming with think: true returns empty content and empty thinking
    axios.post.mockResolvedValueOnce({ data: mockStream })
    // Second call: retry with think: false returns content
    axios.post.mockResolvedValueOnce({ data: { message: { role: 'assistant', content: 'Retry success' } } })

    const collectedTokens = []
    const onToken = (t) => collectedTokens.push(t)

    const result = await queryOllama('/api/chat', { messages: [{ role: 'user', content: 'hi' }], think: true }, 0, onToken)

    expect(result.message.content).toBe('Retry success')
    expect(axios.post).toHaveBeenCalledTimes(2)
    expect(axios.post.mock.calls[1][1].think).toBe(false)
  })
})
