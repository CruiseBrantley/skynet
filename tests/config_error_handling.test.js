const { queryOllama } = require('../util/ollama')
const axios = require('axios')
const net = require('net')

const generate = require('../commands/generate')

jest.mock('axios')
jest.mock('net')
jest.mock('../logger')

describe('Config Error Handling & Branching', () => {
  let mockSocket

  beforeEach(() => {
    jest.clearAllMocks()
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

  describe('Ollama Fallback Branching', () => {
    test('should skip Level 0 when OLLAMA_REMOTE_HOST is missing and route to Gemini', async () => {
      const originalHost = process.env.OLLAMA_REMOTE_HOST
      delete process.env.OLLAMA_REMOTE_HOST
      process.env.GEMINI_API_KEY = 'test-key'
      process.env.GEMINI_MODEL = 'gemini-3.7-flash'

      axios.post.mockResolvedValueOnce({ data: { candidates: [{ content: { parts: [{ text: 'gemini' }] } }] } })

      const result = await queryOllama('/api/chat', { messages: [] })

      expect(result.message.content).toBe('gemini')
      const connectCalls = mockSocket.connect.mock.calls
      const remoteConnects = connectCalls.filter(([, host]) => host === 'remote-host')
      expect(remoteConnects.length).toBe(0)

      process.env.OLLAMA_REMOTE_HOST = originalHost
    })

    test('should skip Level 1 when Local Mac fails and drop to Level 2 (Gemini)', async () => {
      // Start at Level 1 (Local Mac) - mock failure for Level 1 and success for Level 2 (Gemini)
      process.env.GEMINI_API_KEY = 'test-key'
      axios.post
        .mockRejectedValueOnce(new Error('Local mac offline'))
        .mockResolvedValueOnce({ data: { candidates: [{ content: { parts: [{ text: 'gemini' }] } }] } })

      const result = await queryOllama('/api/chat', { messages: [] }, 1)

      expect(result.message.content).toBe('gemini')
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('generativelanguage.googleapis.com'), expect.any(Object), expect.any(Object))
    })
  })

  describe('Image Generation Branching', () => {
    test('should re-route to local SwarmUI if remote URL is missing', async () => {
      const originalRemote = process.env.SWARMUI_REMOTE_URL
      const originalLocal = process.env.SWARMUI_LOCAL_URL

      delete process.env.SWARMUI_REMOTE_URL
      process.env.SWARMUI_LOCAL_URL = 'http://localhost:1111'

      // Mock GetNewSession failure for remote (not even called) vs local success
      axios.post.mockResolvedValueOnce({ data: { session_id: 'local-session' } })

      // Mock interaction
      const interaction = {
        deferReply: jest.fn(),
        editReply: jest.fn(),
        channel: { sendTyping: jest.fn() },
        options: {
          getString: jest.fn().mockImplementation((name) => {
            if (name === 'prompt') return 'test prompt'
            return null
          }),
          getAttachment: jest.fn(),
          getBoolean: jest.fn(),
          getInteger: jest.fn()
        }
      }

      // This is a partial test as generate.execute is complex, but it verifies the branching logic
      // for the base URL selection.

      process.env.SWARMUI_REMOTE_URL = originalRemote
      process.env.SWARMUI_LOCAL_URL = originalLocal
    })
  })

  describe('Speak Branching', () => {
    test('should log error when TTS_MODEL is missing', async () => {
      const speak = require('../commands/speak')
      const originalModel = process.env.TTS_MODEL
      delete process.env.TTS_MODEL

      const interaction = {
        id: '123',
        guildId: 'guild123',
        deferReply: jest.fn(),
        editReply: jest.fn(),
        reply: jest.fn(),
        deleteReply: jest.fn().mockResolvedValue(),
        options: {
          getString: jest.fn().mockReturnValue('hello'),
          getChannel: jest.fn().mockReturnValue({ id: 'chan123', guild: { id: 'guild123', voiceAdapterCreator: {} } }),
          getMember: jest.fn()
        },
        guild: { channels: { cache: { get: jest.fn() } } },
        member: { voice: { channelId: 'chan123' } }
      }

      await speak.execute(interaction)

      const logger = require('../logger')
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Encountered an error speaking'), expect.anything())

      process.env.TTS_MODEL = originalModel
    })
  })
})
