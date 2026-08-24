const restartCommand = require('../commands/restart')

jest.mock('../logger')

describe('Restart Slash Command', () => {
  const originalOwnerId = process.env.OWNER_ID

  beforeAll(() => {
    process.env.OWNER_ID = 'owner-12345'
  })

  afterAll(() => {
    process.env.OWNER_ID = originalOwnerId
  })

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('rejects restart execution from non-owner users', async () => {
    const mockReply = jest.fn().mockResolvedValue({})
    const mockInteraction = {
      user: { id: 'unauthorized-user' },
      reply: mockReply
    }

    await restartCommand.execute(mockInteraction)

    expect(mockReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Only the bot owner can restart'),
      ephemeral: true
    }))
  })

  test('executes graceful restart sequence when called by owner', async () => {
    const mockReply = jest.fn().mockResolvedValue({})
    const mockDestroy = jest.fn().mockResolvedValue()
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {})

    const mockInteraction = {
      user: { id: 'owner-12345', tag: 'Owner#0001' },
      reply: mockReply,
      client: {
        destroy: mockDestroy
      }
    }

    await restartCommand.execute(mockInteraction)

    expect(mockReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }))
    expect(mockReply.mock.calls[0][0].embeds[0].data.title).toBe('🔄 Restarting Skynet')

    // Fast forward timer to trigger graceful exit
    jest.advanceTimersByTime(1000)
    await Promise.resolve() // flush microtask queue
    await Promise.resolve()

    expect(mockDestroy).toHaveBeenCalled()
    expect(mockExit).toHaveBeenCalledWith(0)

    mockExit.mockRestore()
  })
})
