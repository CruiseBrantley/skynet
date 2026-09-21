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

  test('diff ignores null, undefined, and empty string as invalid new values', () => {
    stateStore.set('lol_patch_baseline', '26.18')

    expect(stateStore.diff('lol_patch_baseline', null).hasChanged).toBe(false)
    expect(stateStore.diff('lol_patch_baseline', undefined).hasChanged).toBe(false)
    expect(stateStore.diff('lol_patch_baseline', '').hasChanged).toBe(false)
  })

  test('diff enforces version monotonicity for patch/version keys', () => {
    stateStore.set('lol_patch_baseline', '26.18')

    // Same version -> false
    expect(stateStore.diff('lol_patch_baseline', '26.18').hasChanged).toBe(false)
    // Older / downgraded version (e.g. 26.16 from stale search results) -> false
    expect(stateStore.diff('lol_patch_baseline', '26.16').hasChanged).toBe(false)
    expect(stateStore.diff('lol_patch_baseline', '14.19').hasChanged).toBe(false)
    // Newer version -> true
    expect(stateStore.diff('lol_patch_baseline', '26.19').hasChanged).toBe(true)
    expect(stateStore.diff('lol_patch_baseline', '27.1').hasChanged).toBe(true)
  })

  test('write_state action rejects empty or null values for patch/version keys', async () => {
    stateStore.set('lol_patch_baseline', '26.18')

    const nullRes = await writeStateAction.execute({}, {}, { key: 'lol_patch_baseline', value: null })
    expect(nullRes).toContain('Skipped saving state')
    expect(stateStore.get('lol_patch_baseline')).toBe('26.18')

    const emptyRes = await writeStateAction.execute({}, {}, { key: 'lol_patch_baseline', value: '' })
    expect(emptyRes).toContain('Skipped saving state')
    expect(stateStore.get('lol_patch_baseline')).toBe('26.18')
  })

  test('hasChanged is false by default unless explicitly changed true', async () => {
    // 1. Non-existent baseline -> false by default
    expect(stateStore.diff('uninitialized_key', 'some_val').hasChanged).toBe(false)
    expect(stateStore.diff('uninitialized_patch', '26.19').hasChanged).toBe(false)

    // 2. Existing baseline with identical value -> false
    stateStore.set('game_status', 'active')
    expect(stateStore.diff('game_status', 'active').hasChanged).toBe(false)

    // 3. Existing baseline with invalid / empty values -> false
    expect(stateStore.diff('game_status', '').hasChanged).toBe(false)
    expect(stateStore.diff('game_status', null).hasChanged).toBe(false)
    expect(stateStore.diff('game_status', undefined).hasChanged).toBe(false)

    // 4. Existing baseline with explicitly changed new value -> true
    expect(stateStore.diff('game_status', 'inactive').hasChanged).toBe(true)

    // 5. read_state in workflow context returns hasChanged: false by default
    const wfReadNoDiff = await readStateAction.execute({}, {}, { key: 'game_status' }, { isWorkflow: true })
    expect(wfReadNoDiff.hasChanged).toBe(false)
    expect(wfReadNoDiff.value).toBe('active')

    const wfReadMissingKey = await readStateAction.execute({}, {}, { key: 'missing_key' }, { isWorkflow: true })
    expect(wfReadMissingKey.hasChanged).toBe(false)
    expect(wfReadMissingKey.exists).toBe(false)
  })
})

