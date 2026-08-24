const triggerEngine = require('../util/TriggerEngine')

jest.mock('../logger')

describe('Generic Webhook Ingestion & Trigger Dispatch', () => {
  const originalOwnerId = process.env.OWNER_ID

  beforeAll(() => {
    process.env.OWNER_ID = 'owner-12345'
  })

  afterAll(() => {
    process.env.OWNER_ID = originalOwnerId
  })

  beforeEach(() => {
    triggerEngine._triggers = []
    triggerEngine._lastFired.clear()
    jest.spyOn(triggerEngine, '_load').mockImplementation(() => {})
    jest.spyOn(triggerEngine, '_save').mockImplementation(() => {})
  })

  test('evaluates incoming webhook payload and fires matching webhook trigger', async () => {
    const mockSend = jest.fn().mockResolvedValue({})
    const mockClient = {
      users: { fetch: jest.fn().mockResolvedValue({ send: mockSend }) }
    }

    triggerEngine.init({ client: mockClient })

    // Register a webhook trigger for 'github_release'
    triggerEngine.addTrigger({
      conditionType: 'webhook',
      target: 'github_release',
      threshold: 1,
      actionType: 'alert_owner',
      cooldownMinutes: 5,
      description: 'Alert on GitHub release webhook'
    })

    const payload = {
      repository: 'CruiseBrantley/skynet',
      release: 'v2.5.0',
      author: 'sirian'
    }

    const res = await triggerEngine.evaluateWebhook('github_release', payload, mockClient)
    expect(res.matched).toBe(1)

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            title: expect.stringContaining('Watchdog Trigger Alert')
          })
        })
      ])
    }))
  })

  test('ignores non-matching webhook IDs', async () => {
    const mockSend = jest.fn().mockResolvedValue({})
    const mockClient = {
      users: { fetch: jest.fn().mockResolvedValue({ send: mockSend }) }
    }

    triggerEngine.init({ client: mockClient })

    triggerEngine.addTrigger({
      conditionType: 'webhook',
      target: 'game_status',
      threshold: 1,
      actionType: 'alert_owner',
      cooldownMinutes: 5
    })

    const res = await triggerEngine.evaluateWebhook('unrelated_hook', { data: 123 }, mockClient)
    expect(res.matched).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
  })
})
