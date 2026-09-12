const path = require('path')
const fs = require('fs')
const ActionExecutor = require('../util/ActionExecutor')
const agentMemory = require('../core/memory')
const axios = require('axios')
const { queryOllama } = require('../util/ollama')

jest.mock('axios')

describe('Gemini Tools & Missing Primitives Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GEMINI_API_KEY = 'mock-api-key'
    process.env.NODE_ENV = 'test'
  })

  describe('Gemini Level 2 Function Calling Translation (ollama.js)', () => {
    test('converts OpenAI/Ollama tools into Gemini functionDeclarations and extracts tool_calls', async () => {
      const mockTools = [
        {
          type: 'function',
          function: {
            name: 'host_exec',
            description: 'Execute shell command',
            parameters: {
              type: 'object',
              properties: {
                command: { type: 'string', description: 'Shell command' },
                timeout_ms: { type: 'number', description: 'Timeout' }
              },
              required: ['command']
            }
          }
        }
      ]

      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'host_exec',
                      args: { command: 'ls -la' }
                    }
                  }
                ]
              }
            }
          ]
        }
      })

      const result = await queryOllama('/api/chat', {
        messages: [{ role: 'user', content: 'List the files' }],
        tools: mockTools
      }, 2)

      // Verify request to Gemini had functionDeclarations
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('generateContent'),
        expect.objectContaining({
          tools: [
            expect.objectContaining({
              functionDeclarations: [
                expect.objectContaining({
                  name: 'host_exec',
                  parameters: expect.objectContaining({
                    type: 'OBJECT',
                    properties: expect.objectContaining({
                      command: expect.objectContaining({ type: 'STRING' }),
                      timeout_ms: expect.objectContaining({ type: 'NUMBER' })
                    }),
                    required: ['command']
                  })
                })
              ]
            })
          ]
        }),
        expect.any(Object)
      )

      // Verify tool call extraction
      expect(result.message).toBeDefined()
      expect(result.message.tool_calls).toBeDefined()
      expect(result.message.tool_calls[0].function.name).toBe('host_exec')
      expect(result.message.tool_calls[0].function.arguments).toEqual({ command: 'ls -la' })
    })
  })

  describe('Persistent Memory Actions (remember, recall, forget)', () => {
    const testKey = 'user.test_user.favorite_fruit'
    const testVal = 'Honeycrisp Apple'

    afterEach(() => {
      agentMemory.delete(testKey)
    })

    test('successfully stores, recalls, and forgets memory', async () => {
      // 1. Remember
      const rememberRes = await ActionExecutor.executeAction('remember', {
        key: testKey,
        value: testVal,
        ttl_days: -1
      })
      expect(rememberRes.success).toBe(true)
      expect(rememberRes.key).toBe(testKey)
      expect(rememberRes.value).toBe(testVal)

      // Verify in core memory
      expect(agentMemory.get(testKey)).toBe(testVal)

      // 2. Recall direct
      const recallDirect = await ActionExecutor.executeAction('recall', {
        key: testKey
      })
      expect(recallDirect.success).toBe(true)
      expect(recallDirect.value).toBe(testVal)

      // 3. Recall substring / query
      const recallQuery = await ActionExecutor.executeAction('recall', {
        key: 'test_user'
      })
      expect(recallQuery.success).toBe(true)
      expect(recallQuery.matches.length).toBeGreaterThan(0)

      // 4. Forget
      const forgetRes = await ActionExecutor.executeAction('forget', {
        key: testKey
      })
      expect(forgetRes.success).toBe(true)
      expect(agentMemory.get(testKey)).toBeNull()
    })

    test('remember validates required key and value', async () => {
      const res1 = await ActionExecutor.executeAction('remember', { value: 'val' })
      expect(res1.success).toBe(false)
      expect(res1.error).toContain('key')

      const res2 = await ActionExecutor.executeAction('remember', { key: 'key' })
      expect(res2.success).toBe(false)
      expect(res2.error).toContain('value')
    })
  })

  describe('Discord Message Pinning Actions (pin_message, unpin_message)', () => {
    test('pin_message successfully calls message.pin()', async () => {
      const mockPin = jest.fn().mockResolvedValue(true)
      const mockChannel = {
        id: 'chan-pin',
        messages: {
          fetch: jest.fn().mockResolvedValue({
            id: 'msg-pin-1',
            pin: mockPin
          })
        }
      }

      const result = await ActionExecutor.executeAction('pin_message', {
        message_id: 'msg-pin-1'
      }, { channel: mockChannel })

      expect(result.success).toBe(true)
      expect(mockPin).toHaveBeenCalled()
      expect(result.pinned).toBe(true)
    })

    test('unpin_message successfully calls message.unpin()', async () => {
      const mockUnpin = jest.fn().mockResolvedValue(true)
      const mockChannel = {
        id: 'chan-unpin',
        messages: {
          fetch: jest.fn().mockResolvedValue({
            id: 'msg-unpin-1',
            unpin: mockUnpin
          })
        }
      }

      const result = await ActionExecutor.executeAction('unpin_message', {
        message_id: 'msg-unpin-1'
      }, { channel: mockChannel })

      expect(result.success).toBe(true)
      expect(mockUnpin).toHaveBeenCalled()
      expect(result.unpinned).toBe(true)
    })
  })

  describe('File Upload Action (send_file)', () => {
    const tempFile = path.join(__dirname, '../data/test_upload.txt')

    beforeAll(() => {
      fs.writeFileSync(tempFile, 'Test file upload content', 'utf8')
    })

    afterAll(() => {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
    })

    test('rejects missing or non-existent file', async () => {
      const res1 = await ActionExecutor.executeAction('send_file', {})
      expect(res1.success).toBe(false)
      expect(res1.error).toContain('file_path')

      const res2 = await ActionExecutor.executeAction('send_file', {
        file_path: 'does_not_exist_file.png'
      })
      expect(res2.success).toBe(false)
      expect(res2.error).toContain('not found')
    })

    test('successfully sends file to channel', async () => {
      const mockSend = jest.fn().mockResolvedValue({
        id: 'sent-file-msg'
      })
      const mockChannel = {
        id: 'chan-upload',
        send: mockSend
      }

      const result = await ActionExecutor.executeAction('send_file', {
        file_path: tempFile,
        content: 'Here is the test attachment'
      }, { channel: mockChannel })

      expect(result.success).toBe(true)
      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
        content: 'Here is the test attachment',
        files: [
          expect.objectContaining({
            name: 'test_upload.txt'
          })
        ]
      }))
    })
  })

  describe('Speak Action', () => {
    test('rejects missing text', async () => {
      const result = await ActionExecutor.executeAction('speak', {})
      expect(result.success).toBe(false)
      expect(result.error).toContain('text')
    })

    test('rejects when no guild context exists', async () => {
      const result = await ActionExecutor.executeAction('speak', {
        text: 'Hello world'
      }, {})
      expect(result.success).toBe(false)
      expect(result.error).toContain('server (guild)')
    })
  })
})
