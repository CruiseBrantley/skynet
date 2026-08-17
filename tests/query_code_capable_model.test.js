const axios = require('axios')
const net = require('net')
const { queryCodeCapableModel } = require('../util/ollama')

jest.mock('axios')
jest.mock('net')
jest.mock('../logger')

describe('queryCodeCapableModel Routing', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      OLLAMA_REMOTE_HOST: '192.168.50.182',
      OLLAMA_REMOTE_PORT: '11434',
      OLLAMA_REMOTE_MODEL: 'qwen3.8:27b-5090',
      OLLAMA_LOCAL_MODEL: 'gemma4:e4b',
      GEMINI_API_KEY: 'test-gemini-key',
      GEMINI_MODEL: 'gemini-3.6-flash'
    }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  test('routes to Remote PC (Level 0) when online with think: true and 64k context', async () => {
    // Mock TCP check as online
    net.Socket.prototype.connect = jest.fn(function (port, host, callback) {
      callback()
    })
    net.Socket.prototype.unref = jest.fn()
    net.Socket.prototype.destroy = jest.fn()
    net.Socket.prototype.setTimeout = jest.fn()
    net.Socket.prototype.once = jest.fn()

    axios.post.mockResolvedValueOnce({
      data: {
        message: { role: 'assistant', content: '{"fixed_code": "return 42;"}' }
      }
    })

    const result = await queryCodeCapableModel('/api/chat', {
      messages: [{ role: 'user', content: 'Fix this code' }]
    })

    expect(axios.post).toHaveBeenCalledWith(
      'http://192.168.50.182:11434/api/chat',
      expect.objectContaining({
        model: 'qwen3.8:27b-5090',
        think: true,
        options: expect.objectContaining({
          num_ctx: 65536,
          num_predict: -1
        })
      }),
      expect.any(Object)
    )
    expect(result.message.content).toBe('{"fixed_code": "return 42;"}')
  })

  test('skips Local Mac (Level 1) and routes straight to Gemini (Level 2) when Remote PC is offline', async () => {
    // Mock TCP check as offline
    net.Socket.prototype.connect = jest.fn()
    net.Socket.prototype.unref = jest.fn()
    net.Socket.prototype.destroy = jest.fn()
    net.Socket.prototype.setTimeout = jest.fn()
    net.Socket.prototype.once = jest.fn(function (event, callback) {
      if (event === 'error') callback(new Error('Connection refused'))
    })

    axios.post.mockResolvedValueOnce({
      data: {
        candidates: [{
          content: {
            parts: [{ text: '{"fixed_code": "gemini fixed code"}' }]
          }
        }]
      }
    })

    const result = await queryCodeCapableModel('/api/chat', {
      messages: [{ role: 'user', content: 'Fix this code' }]
    })

    // Must NOT call local Ollama at 127.0.0.1
    expect(axios.post).not.toHaveBeenCalledWith(
      expect.stringContaining('127.0.0.1'),
      expect.anything(),
      expect.anything()
    )

    // MUST call Gemini API
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('https://generativelanguage.googleapis.com/v1/models/gemini-3.6-flash:generateContent'),
      expect.anything(),
      expect.anything()
    )
    expect(result.message.content).toBe('{"fixed_code": "gemini fixed code"}')
  })

  test('falls back directly to Gemini when Remote PC request throws an error', async () => {
    // Mock TCP check as online
    net.Socket.prototype.connect = jest.fn(function (port, host, callback) {
      callback()
    })
    net.Socket.prototype.unref = jest.fn()
    net.Socket.prototype.destroy = jest.fn()
    net.Socket.prototype.setTimeout = jest.fn()
    net.Socket.prototype.once = jest.fn()

    // Remote post fails with timeout/network error
    axios.post.mockRejectedValueOnce(new Error('Remote timeout'))

    // Fallback to Gemini succeeds
    axios.post.mockResolvedValueOnce({
      data: {
        candidates: [{
          content: {
            parts: [{ text: '{"fixed_code": "fallback fixed code"}' }]
          }
        }]
      }
    })

    const result = await queryCodeCapableModel('/api/chat', {
      messages: [{ role: 'user', content: 'Fix this code' }]
    })

    expect(result.message.content).toBe('{"fixed_code": "fallback fixed code"}')
  })

  test('queryOllamaWithContext routes via queryCodeCapableModel when isCodeTask is true', async () => {
    const { queryOllamaWithContext } = require('../util/ollama')

    // Mock Remote PC online
    net.Socket.prototype.connect = jest.fn(function (port, host, callback) {
      callback()
    })
    net.Socket.prototype.unref = jest.fn()
    net.Socket.prototype.destroy = jest.fn()
    net.Socket.prototype.setTimeout = jest.fn()
    net.Socket.prototype.once = jest.fn()

    axios.post.mockResolvedValueOnce({
      data: {
        message: { role: 'assistant', content: '<<<RUN_COMMAND: {"command": "create_slash_command", "name": "roll"}>>>' }
      }
    })

    const result = await queryOllamaWithContext(
      [{ role: 'system', content: 'system' }, { role: 'user', content: 'create slash command roll' }],
      { isCodeTask: true },
      'Skynet'
    )

    expect(axios.post).toHaveBeenCalledWith(
      'http://192.168.50.182:11434/api/chat',
      expect.objectContaining({
        model: 'qwen3.8:27b-5090',
        think: true
      }),
      expect.any(Object)
    )
    expect(result.message.content).toContain('create_slash_command')
  })
})
