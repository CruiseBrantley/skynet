const ActionExecutor = require('../util/ActionExecutor')
const axios = require('axios')

jest.mock('axios')

describe('Agent Extended Tools Suite (Identified Gaps)', () => {
  const OWNER_ID = '199749017150816256'
  const NON_OWNER_ID = '987654321987654321'

  beforeAll(() => {
    process.env.OWNER_ID = OWNER_ID
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('http_request Action', () => {
    test('rejects requests without url', async () => {
      const result = await ActionExecutor.executeAction('http_request', {})
      expect(result.success).toBe(false)
      expect(result.error).toContain('url')
    })

    test('successfully performs GET request', async () => {
      axios.mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: { message: 'hello from api' }
      })

      const result = await ActionExecutor.executeAction('http_request', {
        url: 'https://api.example.com/data',
        method: 'GET'
      })

      expect(result.success).toBe(true)
      expect(result.status).toBe(200)
      expect(result.data).toEqual({ message: 'hello from api' })
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        url: 'https://api.example.com/data',
        method: 'GET'
      }))
    })

    test('successfully performs POST request with JSON string body', async () => {
      axios.mockResolvedValueOnce({
        status: 201,
        statusText: 'Created',
        headers: { 'content-type': 'application/json' },
        data: { id: 123 }
      })

      const result = await ActionExecutor.executeAction('http_request', {
        url: 'https://api.example.com/items',
        method: 'POST',
        body: JSON.stringify({ name: 'Test Item' })
      })

      expect(result.success).toBe(true)
      expect(result.status).toBe(201)
      expect(result.data).toEqual({ id: 123 })
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        method: 'POST',
        data: { name: 'Test Item' }
      }))
    })

    test('handles 404 response without throwing', async () => {
      axios.mockResolvedValueOnce({
        status: 404,
        statusText: 'Not Found',
        headers: {},
        data: { error: 'Not found' }
      })

      const result = await ActionExecutor.executeAction('http_request', {
        url: 'https://api.example.com/missing'
      })

      expect(result.success).toBe(false)
      expect(result.status).toBe(404)
    })

    test('handles network failure', async () => {
      axios.mockRejectedValueOnce(new Error('Network connection refused'))

      const result = await ActionExecutor.executeAction('http_request', {
        url: 'https://unreachable.local'
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network connection refused')
    })
  })

  describe('edit_message Action', () => {
    test('rejects missing parameters', async () => {
      const res1 = await ActionExecutor.executeAction('edit_message', { content: 'test' })
      expect(res1.success).toBe(false)
      expect(res1.error).toContain('message_id')

      const res2 = await ActionExecutor.executeAction('edit_message', { message_id: '123' })
      expect(res2.success).toBe(false)
      expect(res2.error).toContain('content')
    })

    test('rejects editing message authored by someone else', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        id: 'msg-1',
        author: { id: 'other-user-id' }
      })
      const mockChannel = {
        id: 'chan-1',
        messages: { fetch: mockFetch }
      }
      const mockBot = {
        client: {
          user: { id: 'bot-id' }
        }
      }

      const result = await ActionExecutor.executeAction('edit_message', {
        message_id: 'msg-1',
        content: 'new text'
      }, {
        bot: mockBot,
        channel: mockChannel
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Permission denied')
    })

    test('successfully edits bot own message', async () => {
      const mockEdit = jest.fn().mockResolvedValue({
        id: 'msg-1',
        content: 'updated text'
      })
      const mockFetch = jest.fn().mockResolvedValue({
        id: 'msg-1',
        author: { id: 'bot-id' },
        edit: mockEdit
      })
      const mockChannel = {
        id: 'chan-1',
        messages: { fetch: mockFetch }
      }
      const mockBot = {
        client: {
          user: { id: 'bot-id' }
        }
      }

      const result = await ActionExecutor.executeAction('edit_message', {
        message_id: 'msg-1',
        content: 'updated text'
      }, {
        bot: mockBot,
        channel: mockChannel
      })

      expect(result.success).toBe(true)
      expect(mockEdit).toHaveBeenCalledWith({ content: 'updated text' })
      expect(result.content).toBe('updated text')
    })
  })

  describe('delete_message Action', () => {
    test('rejects missing message_id', async () => {
      const result = await ActionExecutor.executeAction('delete_message', {})
      expect(result.success).toBe(false)
      expect(result.error).toContain('message_id')
    })

    test('successfully deletes message', async () => {
      const mockDelete = jest.fn().mockResolvedValue(true)
      const mockFetch = jest.fn().mockResolvedValue({
        id: 'msg-to-delete',
        delete: mockDelete
      })
      const mockChannel = {
        id: 'chan-1',
        messages: { fetch: mockFetch }
      }

      const result = await ActionExecutor.executeAction('delete_message', {
        message_id: 'msg-to-delete',
        reason: 'cleanup'
      }, {
        channel: mockChannel
      })

      expect(result.success).toBe(true)
      expect(mockDelete).toHaveBeenCalled()
      expect(result.deleted).toBe(true)
    })
  })

  describe('fetch_messages Action', () => {
    test('fetches and maps messages cleanly', async () => {
      const sampleMessages = [
        {
          id: 'msg-1',
          author: { id: 'user-1', username: 'Sirian', bot: false },
          content: 'Hello Skynet',
          createdAt: new Date('2026-09-11T20:00:00Z'),
          attachments: new Map(),
          embeds: []
        },
        {
          id: 'msg-2',
          author: { id: 'bot-id', username: 'Skynet', bot: true },
          content: 'Greetings',
          createdAt: new Date('2026-09-11T20:01:00Z'),
          attachments: new Map(),
          embeds: [{ title: 'Info' }]
        }
      ]

      const mockFetch = jest.fn().mockResolvedValue({
        values: () => sampleMessages.values()
      })
      const mockChannel = {
        id: 'chan-1',
        messages: { fetch: mockFetch }
      }

      const result = await ActionExecutor.executeAction('fetch_messages', {
        limit: 10,
        before: 'msg-99'
      }, {
        channel: mockChannel
      })

      expect(result.success).toBe(true)
      expect(result.count).toBe(2)
      expect(result.messages[0].author.username).toBe('Sirian')
      expect(result.messages[1].embedsCount).toBe(1)
      expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({
        limit: 10,
        before: 'msg-99'
      }))
    })
  })

  describe('restart_bot Action & RBAC', () => {
    test('rejects restart_bot for non-owner', async () => {
      const result = await ActionExecutor.executeAction('restart_bot', {}, {
        userId: NON_OWNER_ID,
        isOwner: false,
        isDM: true
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('Access Denied')
    })

    test('rejects restart_bot in public channel', async () => {
      const result = await ActionExecutor.executeAction('restart_bot', {}, {
        userId: OWNER_ID,
        isOwner: true,
        isDM: false,
        guildId: 'guild-123'
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('Access Denied')
    })

    test('accepts restart_bot for owner in private session', async () => {
      const result = await ActionExecutor.executeAction('restart_bot', {
        reason: 'Applying test patch'
      }, {
        userId: OWNER_ID,
        isOwner: true,
        isDM: true
      })
      expect(result.success).toBe(true)
      expect(result.message).toContain('Restart initiated successfully')
    })
  })

  describe('send_message Action Enhancement', () => {
    test('returns messageId and channelId upon sending', async () => {
      const mockSend = jest.fn().mockResolvedValue({
        id: 'sent-msg-123',
        channelId: 'chan-abc'
      })
      const mockChannel = {
        id: 'chan-abc',
        send: mockSend
      }

      const result = await ActionExecutor.executeAction('send_message', {
        content: 'Testing return metadata'
      }, {
        channel: mockChannel
      })

      expect(result.success).toBe(true)
      expect(result.messageId).toBe('sent-msg-123')
      expect(result.channelId).toBe('chan-abc')
    })
  })

  describe('Catalog Verification', () => {
    test('all new actions appear in ActionExecutor catalog', () => {
      const actions = ActionExecutor.listActions({ isOwner: true })
      const names = actions.map(a => a.name)
      expect(names).toContain('http_request')
      expect(names).toContain('edit_message')
      expect(names).toContain('delete_message')
      expect(names).toContain('fetch_messages')
      expect(names).toContain('restart_bot')
      expect(names).toContain('send_message')
    })

    test('schemas are correctly parsed for native tool calling', () => {
      const schemas = ActionExecutor.getOllamaToolsSchema({ isOwner: true, isPrivate: true })
      const schemaNames = schemas.map(s => s.function.name)
      expect(schemaNames).toContain('http_request')
      expect(schemaNames).toContain('edit_message')
      expect(schemaNames).toContain('delete_message')
      expect(schemaNames).toContain('fetch_messages')
      expect(schemaNames).toContain('restart_bot')

      const httpSchema = schemas.find(s => s.function.name === 'http_request')
      expect(httpSchema.function.parameters.properties.url.type).toBe('string')
      expect(httpSchema.function.parameters.properties.timeout_ms.type).toBe('number')
    })
  })
})
