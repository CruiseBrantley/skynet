const stateStore = require('../util/StateStore')
const readStateAction = require('../util/actions/read_state')
const writeStateAction = require('../util/actions/write_state')

describe('StateStore & State Actions', () => {
  beforeEach(() => {
    stateStore._state.clear()
  })

  test('sets and gets operational state values with TTL', () => {
    stateStore.set('test_patch', 'v1.2.3', { ttlDays: 7 })
    expect(stateStore.get('test_patch')).toBe('v1.2.3')

    const entry = stateStore.getEntry('test_patch')
    expect(entry).toBeDefined()
    expect(entry.value).toBe('v1.2.3')
    expect(entry.expiresAt).toBeGreaterThan(Date.now())
  })

  test('diffs new values against stored state baselines', () => {
    stateStore.set('baseline_key', { version: 1, hash: 'abc' })

    // Same value
    const noChange = stateStore.diff('baseline_key', { version: 1, hash: 'abc' })
    expect(noChange.hasChanged).toBe(false)

    // Changed value
    const changed = stateStore.diff('baseline_key', { version: 2, hash: 'xyz' })
    expect(changed.hasChanged).toBe(true)
    expect(changed.previousValue.version).toBe(1)
    expect(changed.newValue.version).toBe(2)
  })

  test('read_state and write_state actions execute properly', async () => {
    const writeRes = await writeStateAction.execute({}, {}, { key: 'd4_season', value: 8, ttl_days: 10 })
    expect(writeRes).toContain('Successfully saved state for "d4_season"')

    const readRes = await readStateAction.execute({}, {}, { key: 'd4_season' })
    expect(readRes).toContain('State Value for "d4_season"')
    expect(readRes).toContain('8')

    const diffRes = await readStateAction.execute({}, {}, { key: 'd4_season', compare_with: 9 })
    expect(diffRes).toContain('"hasChanged": true')
  })
})
