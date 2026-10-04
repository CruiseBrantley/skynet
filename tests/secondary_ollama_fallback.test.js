const axios = require('axios')
const net = require('net')
const childProcess = require('child_process')
const { queryOllama } = require('../util/ollama')
const { areGameServersActive, getGameServerProcesses, clearCache } = require('../util/gameServerDetector')

jest.mock('axios')
jest.mock('net')
jest.mock('../logger')

describe('Secondary Ollama Fallback & Game Server Awareness', () => {
  let mockSocket

  beforeEach(() => {
    jest.clearAllMocks()
    clearCache()

    process.env.OLLAMA_REMOTE_HOST = 'primary-5090'
    process.env.OLLAMA_REMOTE_PORT = '11434'
    process.env.OLLAMA_REMOTE_MODEL = 'qwen3.8-27b'
    process.env.OLLAMA_SECONDARY_HOST = 'secondary-3070'
    process.env.OLLAMA_SECONDARY_PORT = '11434'
    process.env.OLLAMA_SECONDARY_MODEL = 'qwen3.5:9b'
    process.env.OLLAMA_LOCAL_MODEL = 'local-model'
    process.env.GEMINI_API_KEY = 'gemini-key'
    process.env.GEMINI_MODEL = 'gemini-3.8-flash'
    process.env.STEAM_SSH_HOST = 'cruis@secondary-3070'
    process.env.STEAM_SSH_KEY = '/test/key'

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

  afterEach(() => {
    delete process.env.OLLAMA_SECONDARY_HOST
    delete process.env.OLLAMA_SECONDARY_PORT
    delete process.env.OLLAMA_SECONDARY_MODEL
    delete process.env.STEAM_SSH_HOST
    delete process.env.STEAM_SSH_KEY
    clearCache()
  })

  test('getGameServerProcesses reads process names from steam_apps.json', () => {
    const processes = getGameServerProcesses()
    expect(Array.isArray(processes)).toBe(true)
    expect(processes).toContain('IcarusServer-Win64-Shipping.exe')
    expect(processes).toContain('java.exe')
  })

  test('areGameServersActive returns true when a game server process is detected', async () => {
    jest.spyOn(childProcess, 'execFile').mockImplementation((cmd, args, opts, cb) => {
      const callback = typeof cb === 'function' ? cb : (typeof opts === 'function' ? opts : null)
      if (callback) callback(null, '"IcarusServer-Win64-Shipping.exe","1234","Services","0","2,000,000 K"\n"svchost.exe","5678"', '')
    })

    const active = await areGameServersActive({ forceRefresh: true })
    expect(active).toBe(true)
    childProcess.execFile.mockRestore()
  })

  test('areGameServersActive returns false when no game server process is running', async () => {
    jest.spyOn(childProcess, 'execFile').mockImplementation((cmd, args, opts, cb) => {
      const callback = typeof cb === 'function' ? cb : (typeof opts === 'function' ? opts : null)
      if (callback) callback(null, '"Discord.exe","1234","Console","1","50,000 K"\n"svchost.exe","5678"', '')
    })

    const active = await areGameServersActive({ forceRefresh: true })
    expect(active).toBe(false)
    childProcess.execFile.mockRestore()
  })

  test('should route to Secondary Host when Primary is offline and game servers are inactive', async () => {
    let timeoutHandler = null
    mockSocket.once.mockImplementation((event, cb) => {
      if (event === 'timeout' || event === 'error') timeoutHandler = cb
    })
    mockSocket.connect.mockImplementation((p, h, cb) => {
      if (h === 'primary-5090') {
        if (timeoutHandler) setImmediate(timeoutHandler)
      } else {
        if (cb) setImmediate(cb)
      }
    })

    // Mock no game servers running
    jest.spyOn(childProcess, 'execFile').mockImplementation((cmd, args, opts, cb) => {
      const callback = typeof cb === 'function' ? cb : (typeof opts === 'function' ? opts : null)
      if (callback) callback(null, '"svchost.exe","1234"', '')
    })

    axios.post.mockImplementation((url) => {
      if (url.includes('secondary-3070')) {
        return Promise.resolve({ data: { message: { content: 'from-secondary-3070' } } })
      }
      return Promise.reject(new Error('Unexpected call: ' + url))
    })

    const result = await queryOllama('/api/chat', { messages: [{ role: 'user', content: 'test' }] })

    expect(result.message.content).toBe('from-secondary-3070')
    const secondaryCall = axios.post.mock.calls.find(call => call[0].includes('secondary-3070'))
    expect(secondaryCall).toBeDefined()
    expect(secondaryCall[1]).toMatchObject({ model: 'qwen3.5:9b' })

    childProcess.execFile.mockRestore()
  })

  test('should bypass Secondary Host and route directly to Gemini when game servers are active', async () => {
    // Primary is offline
    mockSocket.connect.mockImplementation((p, h, cb) => {
      if (h === 'primary-5090') return // fail primary
      if (cb) setImmediate(cb)
    })
    mockSocket.once.mockImplementation((event, cb) => {
      if (event === 'error' || event === 'timeout') setImmediate(cb)
    })

    // Mock game server running
    jest.spyOn(childProcess, 'execFile').mockImplementation((cmd, args, opts, cb) => {
      const callback = typeof cb === 'function' ? cb : (typeof opts === 'function' ? opts : null)
      if (callback) callback(null, '"IcarusServer-Win64-Shipping.exe","9999","Console","1","3,000,000 K"', '')
    })

    axios.post.mockImplementation((url) => {
      if (url.includes('googleapis')) {
        return Promise.resolve({ data: { candidates: [{ content: { parts: [{ text: 'from-gemini-bypassed-secondary' }] } }] } })
      }
      return Promise.reject(new Error('Unexpected call: ' + url))
    })

    const result = await queryOllama('/api/chat', { messages: [{ role: 'user', content: 'test' }] })

    expect(result.message.content).toBe('from-gemini-bypassed-secondary')
    const secondaryCall = axios.post.mock.calls.find(call => call[0].includes('secondary-3070'))
    expect(secondaryCall).toBeUndefined() // Secondary was bypassed!

    childProcess.execFile.mockRestore()
  })

  test('should cascade to Gemini if Secondary Host fails or returns an error', async () => {
    // Primary is offline
    mockSocket.connect.mockImplementation((p, h, cb) => {
      if (h === 'primary-5090') return
      if (cb) setImmediate(cb)
    })
    mockSocket.once.mockImplementation((event, cb) => {
      if (event === 'error' || event === 'timeout') setImmediate(cb)
    })

    // No game servers
    jest.spyOn(childProcess, 'execFile').mockImplementation((cmd, args, opts, cb) => {
      const callback = typeof cb === 'function' ? cb : (typeof opts === 'function' ? opts : null)
      if (callback) callback(null, '"svchost.exe","1234"', '')
    })

    axios.post.mockImplementation((url) => {
      if (url.includes('secondary-3070')) {
        return Promise.reject(new Error('Secondary CUDA OOM or network error'))
      }
      if (url.includes('googleapis')) {
        return Promise.resolve({ data: { candidates: [{ content: { parts: [{ text: 'from-gemini-after-secondary-failed' }] } }] } })
      }
      return Promise.reject(new Error('Unexpected call: ' + url))
    })

    const result = await queryOllama('/api/chat', { messages: [{ role: 'user', content: 'test' }] })

    expect(result.message.content).toBe('from-gemini-after-secondary-failed')

    childProcess.execFile.mockRestore()
  })
})
