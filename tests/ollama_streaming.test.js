const axios = require('axios')
const net = require('net')
const {
  queryOllama,
  queryOllamaWithContext,
  consumeOllamaStream,
  consumeGeminiStream,
  createStreamWatchdog
} = require('../util/ollama')
const { Readable, PassThrough } = require('stream')

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

  test('createStreamWatchdog fires TTFT timeout when first chunk does not arrive in time', async () => {
    jest.useFakeTimers()
    const onTimeout = jest.fn()
    const watchdog = createStreamWatchdog({
      ttftMs: 50,
      inactivityMs: 30,
      onTimeout
    })

    expect(onTimeout).not.toHaveBeenCalled()
    jest.advanceTimersByTime(55)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onTimeout.mock.calls[0][0].message).toContain('TTFT timeout')

    watchdog.done()
    jest.useRealTimers()
  })

  test('createStreamWatchdog resets on each chunk and fires inactivity timeout when stream stalls', async () => {
    jest.useFakeTimers()
    const onTimeout = jest.fn()
    const watchdog = createStreamWatchdog({
      ttftMs: 100,
      inactivityMs: 40,
      onTimeout
    })

    // Advance 30ms (< TTFT) and provide first chunk
    jest.advanceTimersByTime(30)
    watchdog.onChunk()
    expect(onTimeout).not.toHaveBeenCalled()

    // Advance 30ms (< inactivityMs) and provide second chunk
    jest.advanceTimersByTime(30)
    watchdog.onChunk()
    expect(onTimeout).not.toHaveBeenCalled()

    // Advance 45ms (> inactivityMs) without chunk -> timeout fires!
    jest.advanceTimersByTime(45)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onTimeout.mock.calls[0][0].message).toContain('inactivity timeout')

    watchdog.done()
    jest.useRealTimers()
  })

  test('consumeOllamaStream aborts and throws timeout error when stream stalls', async () => {
    const stream = new PassThrough()
    const abortController = new AbortController()

    const streamPromise = consumeOllamaStream(stream, null, {
      ttftMs: 60,
      inactivityMs: 40,
      abortController
    })

    // Emit first token quickly, then stall without closing stream
    stream.write(JSON.stringify({ message: { content: 'First ' } }) + '\n')

    await expect(streamPromise).rejects.toThrow('Stream inactivity timeout')
    expect(abortController.signal.aborted).toBe(true)
  })

  test('consumeGeminiStream parses SSE data chunks, invokes onToken, and extracts tool calls', async () => {
    const sseLines = [
      'data: {"candidates": [{"content": {"parts": [{"text": "Hello "}]}}]}\n\n',
      ': ping comment line\n\n',
      'data: {"candidates": [{"content": {"parts": [{"text": "from Gemini!"}, {"functionCall": {"name": "web_search", "args": {"query": "Skynet"}}}]}}]}\n\n',
      'data: [DONE]\n\n'
    ]
    const mockStream = Readable.from(sseLines)
    const tokens = []
    const onToken = (t) => tokens.push(t)

    const result = await consumeGeminiStream(mockStream, onToken, { ttftMs: 500, inactivityMs: 500 })

    expect(result.content).toBe('Hello from Gemini!')
    expect(tokens).toEqual(['Hello ', 'from Gemini!'])
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].function.name).toBe('web_search')
    expect(result.toolCalls[0].function.arguments).toEqual({ query: 'Skynet' })
  })

  test('queryOllama Level 2 (Gemini) streams SSE and fails over to candidate model when stream stalls', async () => {
    delete process.env.OLLAMA_REMOTE_HOST
    process.env.GEMINI_MODEL = 'gemini-3.8-flash'
    process.env.GEMINI_TTFT_MS = '60'
    process.env.GEMINI_INACTIVITY_MS = '40'

    // First model: stalled PassThrough stream
    const stalledStream = new PassThrough()
    // Second model: successful SSE stream
    const successStream = Readable.from([
      'data: {"candidates": [{"content": {"parts": [{"text": "Success from 3.7-flash"}]}}]}\n\n'
    ])

    axios.post
      .mockResolvedValueOnce({ data: stalledStream })
      .mockResolvedValueOnce({ data: successStream })

    const tokens = []
    const onToken = (t) => tokens.push(t)

    // Send first chunk, then stall
    setTimeout(() => {
      stalledStream.write('data: {"candidates": [{"content": {"parts": [{"text": "partial"}]}}]}\n\n')
    }, 10)

    const result = await queryOllama('/api/chat', { messages: [{ role: 'user', content: 'test' }] }, 2, onToken)

    expect(result.message.content).toBe('Success from 3.7-flash')
    expect(axios.post).toHaveBeenCalledTimes(2)
    expect(axios.post.mock.calls[0][0]).toContain('gemini-3.8-flash')
    expect(axios.post.mock.calls[1][0]).toContain('gemini-3.7-flash')
  })
})
