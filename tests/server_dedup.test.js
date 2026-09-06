const botAnnounce = require('../events/botAnnounce')
const axios = require('axios')

// Mock express before requiring server
jest.mock('express', () => {
  const mockApp = {
    use: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    listen: jest.fn()
  }
  const mockExpress = jest.fn(() => mockApp)
  mockExpress.json = jest.fn(() => (req, res, next) => next())
  return mockExpress
})

jest.mock('../logger')
jest.mock('../events/botAnnounce')
jest.mock('../server/oauth', () => jest.fn().mockResolvedValue('mock_token'))
jest.mock('../server/ngrok', () => jest.fn().mockResolvedValue('http://mock.ngrok.io'))
jest.mock('axios')

describe('Server Webhook Deduplication', () => {
  let mockBot
  let mockApp

  beforeEach(() => {
    jest.clearAllMocks()
    mockBot = { channels: { fetch: jest.fn() } }

    const { setupServer } = require('../server/server')
    mockApp = setupServer(mockBot)
  })

  test('ignores duplicate webhooks with the same message-id', async () => {
    // Find the POST handler that was registered
    const postCall = mockApp.post.mock.calls.find(call => Array.isArray(call[0]) ? call[0].includes('/') : call[0] === '/')
    const postHandler = postCall[1]

    const messageId = 'msg_unique_999'
    const req = {
      headers: {
        'twitch-eventsub-message-id': messageId
      },
      body: {
        subscription: { id: 'sub_unique' },
        event: { broadcaster_user_id: 'user_unique' }
      }
    }
    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis()
    }

    // Mock internal helper results
    axios.get.mockResolvedValueOnce({ data: { data: [{ id: 'user_unique', game_id: 'game_unique' }] } }) // getChannelInfo
    axios.get.mockResolvedValueOnce({ data: { data: [{ name: 'Test Game' }] } }) // getGameInfo

    // First call
    await postHandler(req, res)
    expect(botAnnounce).toHaveBeenCalledTimes(1)

    // Second call with same messageId
    await postHandler(req, res)
    expect(res.send).toHaveBeenCalledWith('Deduplicated')
    // Still only 1 call to botAnnounce
    expect(botAnnounce).toHaveBeenCalledTimes(1)
  })

  test('checkTwitchHealth detects failed subscriptions and alerts owner via DM', async () => {
    process.env.OWNER_ID = 'owner_123'
    const { checkTwitchHealth } = require('../server/server')

    const mockSend = jest.fn().mockResolvedValue({})
    const botWithUsers = {
      users: {
        fetch: jest.fn().mockResolvedValue({ id: 'owner_123', send: mockSend })
      }
    }

    // Mock getSubscriptions returning a failed subscription
    axios.get.mockResolvedValueOnce({
      data: {
        total: 2,
        data: [
          {
            id: 'sub_fail_1',
            status: 'webhook_callback_verification_failed',
            condition: { broadcaster_user_id: '123' },
            transport: { callback: 'https://sirian.ddns.net/twitch' }
          },
          {
            id: 'sub_ok_2',
            status: 'enabled',
            condition: { broadcaster_user_id: '456' },
            transport: { callback: 'https://sirian.ddns.net/twitch' }
          }
        ]
      }
    })

    const result = await checkTwitchHealth(botWithUsers)
    expect(result.healthy).toBe(false)
    expect(result.failedSubs.length).toBe(1)
    expect(mockSend).toHaveBeenCalledWith(expect.stringContaining('Twitch Ingress Alert'))
  })

  test('GET /api/conversations/history resolves authenticated session and calls authManager.getUser without crashing', async () => {
    const authManager = require('../server/auth/AuthManager')
    const user = authManager.upsertUser({
      id: 'test_user_history_123',
      provider: 'discord',
      username: 'historyuser',
      displayName: 'History User'
    })
    const token = authManager.createSessionToken(user)

    const historyCall = mockApp.get.mock.calls.find(call => call[0] === '/api/conversations/history')
    expect(historyCall).toBeDefined()
    const historyHandler = historyCall[1]

    const req = {
      headers: {
        cookie: `skynet_session=${encodeURIComponent(token)}`
      },
      query: {}
    }
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    }

    await historyHandler(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    const jsonOutput = res.json.mock.calls[0][0]
    expect(jsonOutput.success).toBe(true)
    expect(jsonOutput.profile).toBe('user_test_user_history_123')

    // Clean up test user
    authManager._users.delete('test_user_history_123')
    authManager._saveUsers()
  })
})
