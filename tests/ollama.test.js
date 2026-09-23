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
      .mockResolvedValueOnce({ data: { candidates: [{ content: { parts: [{ text: 'from-3.7-flash' }] } }] } })

    const result = await queryOllama('/api/chat', { messages: [] })

    expect(result.message.content).toBe('from-3.7-flash')
    expect(axios.post).toHaveBeenCalledTimes(2)
    expect(axios.post.mock.calls[0][0]).toContain('gemini-3.8-flash')
    expect(axios.post.mock.calls[1][0]).toContain('gemini-3.7-flash')
  })

  test('should failover to Level 3 (Local Mac Mini) with keep_alive 2m when Gemini fails across all candidate models', async () => {
    delete process.env.OLLAMA_REMOTE_HOST

    const err500 = new Error('Gemini API 500 error')
    err500.response = { status: 500, data: { error: { message: 'Internal error' } } }

    axios.post.mockImplementation((url) => {
      if (url.includes('127.0.0.1')) {
        return Promise.resolve({ data: { message: { content: 'from-local-level-3' } } })
      }
      return Promise.reject(err500)
    })

    const result = await queryOllama('/api/chat', { messages: [] })

    expect(result.message.content).toBe('from-local-level-3')
    const localCall = axios.post.mock.calls.find(call => call[0].includes('127.0.0.1'))
    expect(localCall).toBeDefined()
    expect(localCall[1]).toMatchObject({
      model: 'local-model',
      keep_alive: '2m'
    })
  })

  test('should failover to Level 3 (Local Mac Mini) when GEMINI_API_KEY is missing', async () => {
    delete process.env.OLLAMA_REMOTE_HOST
    delete process.env.GEMINI_API_KEY

    axios.post.mockResolvedValueOnce({ data: { message: { content: 'from-local-no-key' } } })

    const result = await queryOllama('/api/chat', { messages: [] })

    expect(result.message.content).toBe('from-local-no-key')
    expect(axios.post.mock.calls[0][0]).toContain('127.0.0.1')
    expect(axios.post.mock.calls[0][1]).toMatchObject({
      model: 'local-model',
      keep_alive: '2m'
    })
  })

  test('should throw if Level 0, Level 2, and Level 3 all fail', async () => {
    delete process.env.OLLAMA_REMOTE_HOST
    const err = new Error('All models dead')
    axios.post.mockRejectedValue(err)

    await expect(queryOllama('/api/chat', { messages: [] })).rejects.toThrow('All models dead')
  })
})

describe('queryLocalOrRemote — Standard cascade delegation', () => {
  const { queryLocalOrRemote } = require('../util/ollama')
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

  test('calls remote PC when online', async () => {
    axios.post.mockResolvedValueOnce({ data: { message: { content: 'from-remote' } } })

    const result = await queryLocalOrRemote('/api/chat', { messages: [] })

    expect(result.message.content).toBe('from-remote')
    expect(axios.post).toHaveBeenCalledTimes(1)
    expect(axios.post.mock.calls[0][0]).toContain('remote-host')
    expect(axios.post.mock.calls[0][0]).not.toContain('googleapis')
  })

  test('falls back to Gemini (Level 2) when remote is offline — zero Mac Mini load', async () => {
    // Remote port check fails
    mockSocket.connect.mockImplementation((p, h, cb) => {
      if (p === 11434 && h === 'remote-host') {
        // timeout
      }
    })
    mockSocket.once.mockImplementation((event, cb) => {
      if (event === 'error' || event === 'timeout') setImmediate(cb)
    })

    // Gemini responds
    axios.post.mockResolvedValueOnce({ data: { candidates: [{ content: { parts: [{ text: 'from-gemini' }] } }] } })

    const result = await queryLocalOrRemote('/api/chat', { messages: [] })

    expect(result.message.content).toBe('from-gemini')
    expect(axios.post.mock.calls[0][0]).toContain('googleapis')
    expect(axios.post.mock.calls.some(c => c[0].includes('127.0.0.1'))).toBe(false)
  })

  test('falls back to Gemini when remote throws', async () => {
    axios.post
      .mockRejectedValueOnce(new Error('remote timeout'))
      .mockResolvedValueOnce({ data: { candidates: [{ content: { parts: [{ text: 'gemini-fallback' }] } }] } })

    const result = await queryLocalOrRemote('/api/chat', { messages: [] })

    expect(result.message.content).toBe('gemini-fallback')
    expect(axios.post.mock.calls[1][0]).toContain('googleapis')
  })

  test('skips remote and goes straight to Gemini when OLLAMA_REMOTE_HOST is missing', async () => {
    delete process.env.OLLAMA_REMOTE_HOST
    axios.post.mockResolvedValueOnce({ data: { candidates: [{ content: { parts: [{ text: 'gemini-only' }] } }] } })

    const result = await queryLocalOrRemote('/api/chat', { messages: [] })

    expect(result.message.content).toBe('gemini-only')
    const connectCalls = mockSocket.connect.mock.calls
    const remoteConnects = connectCalls.filter(([, host]) => host === 'remote-host')
    expect(remoteConnects.length).toBe(0)
    expect(axios.post.mock.calls[0][0]).toContain('googleapis')
  })

  test('falls back to Level 3 (Local Mac Mini with keep_alive 2m) when remote and Gemini both fail', async () => {
    // Remote port check fails
    mockSocket.connect.mockImplementation((p, h, cb) => {
      if (p === 11434 && h === 'remote-host') {
        // timeout
      }
    })
    mockSocket.once.mockImplementation((event, cb) => {
      if (event === 'error' || event === 'timeout') setImmediate(cb)
    })

    const err500 = new Error('Gemini down')
    err500.response = { status: 500, data: { error: { message: 'Gemini 500' } } }

    axios.post.mockImplementation((url) => {
      if (url.includes('127.0.0.1')) {
        return Promise.resolve({ data: { message: { content: 'from-local-emergency' } } })
      }
      return Promise.reject(err500)
    })

    const result = await queryLocalOrRemote('/api/chat', { messages: [] })

    expect(result.message.content).toBe('from-local-emergency')
    const localCall = axios.post.mock.calls.find(c => c[0].includes('127.0.0.1'))
    expect(localCall).toBeDefined()
    expect(localCall[1]).toMatchObject({
      model: 'local-model',
      keep_alive: '2m'
    })
  })

  test('throws when remote, Gemini, and local Mac Mini all fail', async () => {
    // Remote port check fails
    mockSocket.connect.mockImplementation((p, h, cb) => {
      if (p === 11434 && h === 'remote-host') {
        // timeout
      }
    })
    mockSocket.once.mockImplementation((event, cb) => {
      if (event === 'error' || event === 'timeout') setImmediate(cb)
    })

    const err = new Error('All tiers dead')
    axios.post.mockRejectedValue(err)

    await expect(queryLocalOrRemote('/api/chat', { messages: [] })).rejects.toThrow('All tiers dead')
  })
})
