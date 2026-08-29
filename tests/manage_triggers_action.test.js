const manageTriggers = require('../util/actions/manage_triggers')
const triggerEngine = require('../util/TriggerEngine')

jest.mock('../logger')

describe('manage_triggers Action', () => {
  beforeEach(() => {
    triggerEngine._triggers = []
  })

  test('creates, lists, tests, and deletes triggers via action interface', async () => {
    // 1. List empty
    const emptyList = await manageTriggers.execute({}, {}, { action: 'list' })
    expect(emptyList).toContain('No active conditional triggers')

    // 2. Create trigger
    const createRes = await manageTriggers.execute({}, {}, {
      action: 'create',
      condition_type: 'command_error_streak',
      target: 'netstats',
      threshold: 3,
      action_type: 'auto_rollback',
      description: 'Auto-rollback netstats on 3 errors'
    })

    expect(createRes).toContain('Successfully registered reactive trigger')
    expect(createRes).toContain('command_error_streak')
    expect(createRes).toContain('auto_rollback')

    // Extract created trigger id
    const match = createRes.match(/trig_\d+_[a-z0-9]+/i)
    expect(match).not.toBeNull()
    const triggerId = match[0]

    // 3. List active
    const listRes = await manageTriggers.execute({}, {}, { action: 'list' })
    expect(listRes).toContain('Reactive Watchdog Triggers')
    expect(listRes).toContain(triggerId)

    // 4. Disable and Enable
    const disableRes = await manageTriggers.execute({}, {}, { action: 'disable', condition_type: 'command_error_streak' })
    expect(disableRes).toContain('Successfully disabled watchdog trigger')

    const enableRes = await manageTriggers.execute({}, {}, { action: 'enable', trigger_id: triggerId })
    expect(enableRes).toContain('Successfully enabled watchdog trigger')

    // 5. Test trigger dispatch
    const testRes = await manageTriggers.execute({}, {}, { action: 'test', trigger_id: triggerId })
    expect(testRes).toContain('Dispatched simulated test execution')

    // 6. Delete trigger
    const deleteRes = await manageTriggers.execute({}, {}, { action: 'delete', trigger_id: triggerId })
    expect(deleteRes).toContain('Successfully deleted trigger')
  })
})
