const { queryOllama } = require('../util/ollama')
const axios = require('axios')
const net = require('net')

jest.mock('axios')
jest.mock('net')
jest.mock('../logger')

jest.setTimeout(30000)

describe('Ollama Fallback Hierarchy', () => {
  let mockSocket

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OLLAMA_REMOTE_HOST = 'remote-host'
    process.env.OLLAMA_REMOTE_PORT = '11434'
    process.env.OLLAMA_REMOTE_MODEL = 'remote-model'
    process.env.OLLAMA_LOCAL_MODEL = 'local-model'
    process.env.GEMINI_API_KEY = 'gemini-key'
    process.env.GEMINI_MODEL = 'gemini-model'

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

  test('should use Level 0 (Remote) when online', async () => {
    axios.post.mockResolvedValueOnce({ data: { message: { content: 'remote' } } })
    const result = await queryOllama('/api/chat', { messages: [] })
    expect(result.message.content).toBe('remote')
  })

  test('should failover directly to Level 2 (Gemini) when Remote is offline', async () => {
    // Mock remote port as closed
    mockSocket.connect.mockImplementation((p, h, cb) => {
      if (p === 11434 && h === 'remote-host') return // fail
      if (cb) setImmediate(cb)
    })
    mockSocket.once.mockImplementation((event, cb) => {
      if (event === 'error' || event === 'timeout') setImmediate(cb)
    })

    axios.post.mockResolvedValueOnce({ data: { candidates: [{ content: { parts: [{ text: 'gemini' }] } }] } })
    const result = await queryOllama('/api/chat', { messages: [] })
    expect(result.message.content).toBe('gemini')
    // Verification: local was bypassed, call went straight to Gemini
    expect(axios.post.mock.calls[0][0]).toContain('googleapis')
  })

  test('should failover directly to Level 2 (Gemini) when Remote errors', async () => {
    axios.post.mockRejectedValueOnce(new Error('Remote timeout or VRAM crash'))
    axios.post.mockResolvedValueOnce({ data: { candidates: [{ content: { parts: [{ text: 'gemini' }] } }] } })

    const result = await queryOllama('/api/chat', { messages: [] })
    expect(result.message.content).toBe('gemini')
    expect(axios.post.mock.calls[1][0]).toContain('googleapis')
  })

  test('should skip Level 0 entirely and route directly to Gemini if OLLAMA_REMOTE_HOST is missing', async () => {
    delete process.env.OLLAMA_REMOTE_HOST
    axios.post.mockResolvedValueOnce({ data: { candidates: [{ content: { parts: [{ text: 'gemini' }] } }] } })

    const result = await queryOllama('/api/chat', { messages: [] })

    expect(result.message.content).toBe('gemini')
    const connectCalls = mockSocket.connect.mock.calls
    const remoteConnects = connectCalls.filter(([, host]) => host === 'remote-host')
    expect(remoteConnects.length).toBe(0)
    expect(axios.post.mock.calls[0][0]).toContain('googleapis')
  })

  test('should allow Level 1 (Local Mac) when explicitly requested', async () => {
    axios.post.mockResolvedValueOnce({ data: { message: { content: 'local-explicit' } } })
    const result = await queryOllama('/api/chat', { messages: [] }, 1)
    expect(result.message.content).toBe('local-explicit')
    expect(axios.post.mock.calls[0][0]).toContain('127.0.0.1')
  })

  test('should cascade across candidateModels when primary Gemini model returns 503 high demand', async () => {
    delete process.env.OLLAMA_REMOTE_HOST
    process.env.GEMINI_MODEL = 'gemini-3.8-flash'

    // First model (3.8-flash) fails with 503
    const err503 = new Error('High demand')
    err503.response = { status: 503, data: { error: { message: 'High demand' } } }

    axios.post
      .mockRejectedValueOnce(err503)
      .mockResolvedValueOnce({ data: { candidates: [{ content: { parts: [{ text: 'from-2.5-flash' }] } }] } })

    const result = await queryOllama('/api/chat', { messages: [] })

    expect(result.message.content).toBe('from-2.5-flash')
    expect(axios.post).toHaveBeenCalledTimes(2)
    expect(axios.post.mock.calls[0][0]).toContain('gemini-3.8-flash')
    expect(axios.post.mock.calls[1][0]).toContain('gemini-2.5-flash')
  })
})

describe('queryLocalOrRemote — Gemini-free routing', () => {
  const { queryLocalOrRemote } = require('../util/ollama')
  let mockSocket

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OLLAMA_REMOTE_HOST = 'remote-host'
    process.env.OLLAMA_REMOTE_PORT = '11434'
    process.env.OLLAMA_REMOTE_MODEL = 'remote-model'
    process.env.OLLAMA_LOCAL_MODEL = 'local-model'
    process.env.GEMINI_API_KEY = 'gemini-key'

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

  test('calls remote PC when online — never Gemini', async () => {
    axios.post.mockResolvedValueOnce({ data: { message: { content: 'from-remote' } } })

    const result = await queryLocalOrRemote('/api/chat', { messages: [] })

    expect(result.message.content).toBe('from-remote')
    // Exactly one axios POST — to the remote PC, not Gemini
    expect(axios.post).toHaveBeenCalledTimes(1)
    expect(axios.post.mock.calls[0][0]).toContain('remote-host')
    expect(axios.post.mock.calls[0][0]).not.toContain('googleapis')
  })

  test('falls back to local (level 2) when remote is offline — never Gemini', async () => {
    // Remote port check fails
    mockSocket.connect.mockImplementation((p, h, cb) => {
      if (p === 11434 && h === 'remote-host') {
        // no callback = timeout
      }
    })
    mockSocket.once.mockImplementation((event, cb) => {
      if (event === 'error' || event === 'timeout') setImmediate(cb)
    })

    // Local model responds
    axios.post.mockResolvedValueOnce({ data: { message: { content: 'from-local' } } })

    const result = await queryLocalOrRemote('/api/chat', { messages: [] })

    expect(result.message.content).toBe('from-local')
    // The local call should go to 127.0.0.1, not googleapis
    expect(axios.post.mock.calls[0][0]).not.toContain('googleapis')
  })

  test('falls back to local when remote throws — never Gemini', async () => {
    // Port check succeeds but POST fails
    axios.post
      .mockRejectedValueOnce(new Error('remote timeout'))
      .mockResolvedValueOnce({ data: { message: { content: 'local-fallback' } } })

    const result = await queryLocalOrRemote('/api/chat', { messages: [] })

    expect(result.message.content).toBe('local-fallback')
    // Gemini URL was never called
    const urls = axios.post.mock.calls.map(c => c[0])
    expect(urls.some(u => u.includes('googleapis'))).toBe(false)
  })

  test('skips remote and goes straight to local when OLLAMA_REMOTE_HOST is missing', async () => {
    delete process.env.OLLAMA_REMOTE_HOST
    axios.post.mockResolvedValueOnce({ data: { message: { content: 'local-only' } } })

    const result = await queryLocalOrRemote('/api/chat', { messages: [] })

    expect(result.message.content).toBe('local-only')
    // Any socket checks should be against localhost, never the remote host
    const connectCalls = mockSocket.connect.mock.calls
    const remoteConnects = connectCalls.filter(([, host]) => host === 'remote-host')
    expect(remoteConnects.length).toBe(0)
  })

  test('strictly never calls Gemini even if both remote and local fail', async () => {
    // Remote port check succeeds but remote post fails
    axios.post.mockRejectedValueOnce(new Error('remote dead'))
    // Local post also fails
    axios.post.mockRejectedValueOnce(new Error('local dead'))

    await expect(queryLocalOrRemote('/api/chat', { messages: [] })).rejects.toThrow('local dead')

    // Verify googleapis was never called
    const urls = axios.post.mock.calls.map(c => c[0])
    expect(urls.some(u => u.includes('googleapis'))).toBe(false)
  })
})
