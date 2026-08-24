const triggerEngine = require('../util/TriggerEngine')
const telemetry = require('../util/telemetry')
const selfHealing = require('../util/chat/SelfHealingEngine')

jest.mock('../logger')

describe('TriggerEngine Reactive Watchdog & Conditional Triggers', () => {
  const originalOwnerId = process.env.OWNER_ID

  beforeAll(() => {
    process.env.OWNER_ID = 'owner-12345'
  })

  afterAll(() => {
    process.env.OWNER_ID = originalOwnerId
  })

  beforeEach(() => {
    jest.clearAllMocks()
    triggerEngine._triggers = []
    triggerEngine._lastFired.clear()
    jest.spyOn(triggerEngine, '_save').mockImplementation(() => {})
    telemetry.events = []
  })

  test('registers, lists, and deletes conditional triggers', () => {
    const trig = triggerEngine.addTrigger({
      conditionType: 'command_error_streak',
      target: 'netstats',
      threshold: 3,
      actionType: 'alert_owner',
      cooldownMinutes: 10,
      description: 'Alert if netstats fails 3 times'
    })

    expect(trig.id).toBeDefined()
    expect(triggerEngine.listTriggers().length).toBe(1)

    const deleted = triggerEngine.deleteTrigger(trig.id)
    expect(deleted).toBe(true)
    expect(triggerEngine.listTriggers().length).toBe(0)
  })

  test('trips command_error_streak trigger when threshold consecutive errors occur', async () => {
    const mockSend = jest.fn().mockResolvedValue({})
    const mockClient = {
      users: {
        fetch: jest.fn().mockResolvedValue({
          send: mockSend
        })
      }
    }

    triggerEngine.init({ telemetry, client: mockClient })

    triggerEngine.addTrigger({
      conditionType: 'command_error_streak',
      target: 'netstats',
      threshold: 2,
      actionType: 'alert_owner',
      cooldownMinutes: 5,
      description: 'Alert on 2 consecutive netstats errors'
    })

    // Event 1: Failure 1
    await telemetry.trackCommandExecution({
      commandName: 'netstats',
      success: false,
      error: 'Error 1'
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(mockSend).not.toHaveBeenCalled()

    // Event 2: Failure 2 (Should trip trigger)
    await telemetry.trackCommandExecution({
      commandName: 'netstats',
      success: false,
      error: 'Error 2'
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            title: expect.stringContaining('Watchdog Trigger Alert')
          })
        })
      ])
    }))

    // Event 3: Failure 3 (Should be suppressed by 5 min cooldown)
    mockSend.mockClear()
    await telemetry.trackCommandExecution({
      commandName: 'netstats',
      success: false,
      error: 'Error 3'
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(mockSend).not.toHaveBeenCalled()
  })

  test('dispatches auto_heal action when error streak trigger trips', async () => {
    const mockPropose = jest.spyOn(selfHealing, 'proposeSlashCommandFix').mockResolvedValue({ success: true })

    triggerEngine.init({ telemetry, selfHealing, client: {} })

    triggerEngine.addTrigger({
      conditionType: 'command_error_streak',
      target: 'roll',
      threshold: 2,
      actionType: 'auto_heal',
      cooldownMinutes: 5
    })

    await telemetry.trackCommandExecution({ commandName: 'roll', success: false, error: 'Bug' })
    await telemetry.trackCommandExecution({ commandName: 'roll', success: false, error: 'Bug again' })
    await Promise.resolve()
    await Promise.resolve()

    expect(mockPropose).toHaveBeenCalledWith(expect.objectContaining({
      commandName: 'roll'
    }))

    mockPropose.mockRestore()
  })

  test('evaluates resource metric triggers (bot_memory)', async () => {
    const mockSend = jest.fn().mockResolvedValue({})
    const mockClient = {
      users: {
        fetch: jest.fn().mockResolvedValue({
          send: mockSend
        })
      }
    }

    triggerEngine.init({ telemetry, client: mockClient })

    // Set threshold very low (e.g. 1 MB) so it trips on active node process
    triggerEngine.addTrigger({
      conditionType: 'bot_memory',
      threshold: 1, // 1 MB
      actionType: 'alert_owner',
      cooldownMinutes: 10,
      description: 'Memory threshold test'
    })

    await triggerEngine.evaluateResourceMetrics(mockClient)

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }))
  })

  test('trips command_error_rate trigger when error percentage is exceeded', async () => {
    const mockSend = jest.fn().mockResolvedValue({})
    const mockClient = {
      users: { fetch: jest.fn().mockResolvedValue({ send: mockSend }) }
    }

    triggerEngine.init({ telemetry, client: mockClient })

    triggerEngine.addTrigger({
      conditionType: 'command_error_rate',
      target: 'ping',
      threshold: 50, // 50%
      actionType: 'alert_owner',
      cooldownMinutes: 5
    })

    // Add 2 successes and 2 failures (50% failure rate with >= 3 events)
    await telemetry.trackCommandExecution({ commandName: 'ping', success: true })
    await telemetry.trackCommandExecution({ commandName: 'ping', success: false, error: 'Fail 1' })
    await telemetry.trackCommandExecution({ commandName: 'ping', success: false, error: 'Fail 2' })
    await Promise.resolve()
    await Promise.resolve()

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }))
  })

  test('dispatches auto_rollback when error streak trips on command with backup', async () => {
    const mockRollback = jest.spyOn(selfHealing, 'rollbackRepair').mockResolvedValue({ success: true, name: 'netstats' })
    jest.spyOn(triggerEngine, '_findLatestBackup').mockReturnValue('bak_slash_netstats_12345')

    const mockSend = jest.fn().mockResolvedValue({})
    const mockClient = {
      users: { fetch: jest.fn().mockResolvedValue({ send: mockSend }) }
    }

    triggerEngine.init({ telemetry, selfHealing, client: mockClient })

    triggerEngine.addTrigger({
      conditionType: 'command_error_streak',
      target: 'netstats',
      threshold: 2,
      actionType: 'auto_rollback',
      cooldownMinutes: 5
    })

    await telemetry.trackCommandExecution({ commandName: 'netstats', success: false, error: 'Crash 1' })
    await telemetry.trackCommandExecution({ commandName: 'netstats', success: false, error: 'Crash 2' })
    for (let i = 0; i < 5; i++) await Promise.resolve()

    expect(mockRollback).toHaveBeenCalledWith('bak_slash_netstats_12345', 'owner-12345', mockClient)
    expect(mockSend).toHaveBeenCalledWith(expect.stringContaining('Automated Watchdog Rollback'))

    mockRollback.mockRestore()
  })

  test('starts and stops periodic watchdog timer cleanly', () => {
    triggerEngine.startWatchdog({}, 5000)
    expect(triggerEngine._watchdogTimer).not.toBeNull()

    triggerEngine.stopWatchdog()
    expect(triggerEngine._watchdogTimer).toBeNull()
  })
})
