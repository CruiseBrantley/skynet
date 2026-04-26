/**
 * Tests for AgentLoop's action management tool calls:
 * create_action, modify_action, delete_action
 *
 * These verify that the AgentLoop's _executeCommand handler correctly
 * delegates to ActionExecutor and handles both success and failure paths.
 */

// ─── Top-level mocks (must be before any require) ─────────────────────────────

jest.mock('../util/AgentMemory', () => ({
  getSummary: jest.fn().mockReturnValue(''),
  set: jest.fn(),
  delete: jest.fn(),
  get: jest.fn()
}))

jest.mock('../util/AgentScheduler', () => ({
  getAll: jest.fn().mockReturnValue([]),
  add: jest.fn().mockReturnValue({ id: 'task_test_1', scheduledAt: Date.now() + 60_000 }),
  cancel: jest.fn().mockReturnValue(true)
}))

jest.mock('../util/AgentClock', () => ({
  resolveTime: jest.fn().mockResolvedValue(Date.now() + 3_600_000)
}))

jest.mock('../util/ollama', () => ({
  queryOllama: jest.fn(),
  queryLocalOrRemote: jest.fn()
}))

jest.mock('jsonrepair', () => ({ jsonrepair: s => s }))

// ─── ActionExecutor mock factory ──────────────────────────────────────────────

const buildExecutorMock = (overrides = {}) => ({
  registerAction: jest.fn().mockReturnValue({ success: true }),
  modifyAction: jest.fn().mockReturnValue({ success: true }),
  deleteAction: jest.fn().mockReturnValue({ success: true }),
  listActions: jest.fn().mockReturnValue([
    { name: 'send_message', description: 'Sends text', schema: {} },
    { name: 'send_poll', description: 'Creates poll', schema: {} }
  ]),
  execute: jest.fn().mockResolvedValue(true),
  ...overrides
})

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('AgentLoop — Action Management Tools', () => {
  let loop
  let mockOllama
  let mockExecutor

  // Helper: make the background LLM return a specific RUN_COMMAND, then NOOP
  const withCommand = (cmdJson) => {
    mockOllama.queryLocalOrRemote
      .mockResolvedValueOnce({ message: { content: `<<<RUN_COMMAND: ${JSON.stringify(cmdJson)}>>>` } })
      .mockResolvedValueOnce({ message: { content: 'NOOP' } })
  }

  beforeEach(() => {
    jest.resetModules()

    // Rebuild mocks fresh after resetModules
    jest.mock('../util/AgentMemory', () => ({
      getSummary: jest.fn().mockReturnValue(''),
      set: jest.fn(),
      delete: jest.fn(),
      get: jest.fn()
    }))
    jest.mock('../util/AgentScheduler', () => ({
      getAll: jest.fn().mockReturnValue([]),
      add: jest.fn().mockReturnValue({ id: 'task_test_1', scheduledAt: Date.now() + 60_000 }),
      cancel: jest.fn().mockReturnValue(true)
    }))
    jest.mock('../util/AgentClock', () => ({
      resolveTime: jest.fn().mockResolvedValue(Date.now() + 3_600_000)
    }))
    jest.mock('../util/ollama', () => ({
      queryOllama: jest.fn(),
      queryLocalOrRemote: jest.fn()
    }))
    jest.mock('jsonrepair', () => ({ jsonrepair: s => s }))

    mockExecutor = buildExecutorMock()
    jest.mock('../util/ActionExecutor', () => mockExecutor)

    loop = require('../util/AgentLoop')
    mockOllama = require('../util/ollama')
  })

  afterEach(() => loop.stop())

  // ─── create_action ────────────────────────────────────────────────────────

  describe('create_action command', () => {
    test('calls registerAction with correct args', async () => {
      withCommand({
        command: 'create_action',
        name: 'my_action',
        description: 'Posts a greeting',
        schema: { content: 'string' },
        code: 'await channel.send(params.content);'
      })

      await loop.runOnce()

      expect(mockExecutor.registerAction).toHaveBeenCalledWith(
        'my_action',
        'Posts a greeting',
        { content: 'string' },
        'await channel.send(params.content);'
      )
    })

    test('returns a descriptive action string on success', async () => {
      withCommand({
        command: 'create_action',
        name: 'my_action',
        description: 'Posts a greeting',
        code: 'await channel.send("hi");'
      })

      await loop.runOnce()

      // The action description should appear in recentActions
      const recent = loop.status.recentActions
      expect(recent.some(r => r.includes('create_action') && r.includes('my_action'))).toBe(true)
    })

    test('returns null and does not recurse when name is missing', async () => {
      withCommand({
        command: 'create_action',
        description: 'Missing name',
        code: 'await channel.send("hi");'
      })

      await loop.runOnce()
      expect(mockExecutor.registerAction).not.toHaveBeenCalled()
    })

    test('returns null and does not recurse when code is missing', async () => {
      withCommand({
        command: 'create_action',
        name: 'bad_action',
        description: 'Missing code'
      })

      await loop.runOnce()
      expect(mockExecutor.registerAction).not.toHaveBeenCalled()
    })

    test('returns null when registerAction fails', async () => {
      mockExecutor.registerAction.mockReturnValue({ success: false, error: 'Forbidden op' })
      withCommand({
        command: 'create_action',
        name: 'bad_action',
        description: 'Evil',
        code: 'process.exit(1);'
      })

      await loop.runOnce()

      const recent = loop.status.recentActions
      expect(recent.some(r => r.includes('create_action'))).toBe(false)
    })
  })

  // ─── modify_action ────────────────────────────────────────────────────────

  describe('modify_action command', () => {
    test('calls modifyAction with description update', async () => {
      withCommand({
        command: 'modify_action',
        name: 'my_action',
        description: 'Updated description'
      })

      await loop.runOnce()

      expect(mockExecutor.modifyAction).toHaveBeenCalledWith('my_action', {
        description: 'Updated description'
      })
    })

    test('calls modifyAction with code update', async () => {
      withCommand({
        command: 'modify_action',
        name: 'my_action',
        code: 'await channel.send("updated");'
      })

      await loop.runOnce()

      expect(mockExecutor.modifyAction).toHaveBeenCalledWith('my_action', {
        code: 'await channel.send("updated");'
      })
    })

    test('passes only provided fields — omits undefined', async () => {
      withCommand({
        command: 'modify_action',
        name: 'my_action',
        description: 'New desc'
        // no code, no schema
      })

      await loop.runOnce()

      const callArgs = mockExecutor.modifyAction.mock.calls[0][1]
      expect(callArgs).not.toHaveProperty('code')
      expect(callArgs).not.toHaveProperty('schema')
    })

    test('returns null when name is missing', async () => {
      withCommand({ command: 'modify_action', description: 'nameless update' })
      await loop.runOnce()
      expect(mockExecutor.modifyAction).not.toHaveBeenCalled()
    })

    test('returns null when no update fields provided', async () => {
      withCommand({ command: 'modify_action', name: 'my_action' })
      await loop.runOnce()
      expect(mockExecutor.modifyAction).not.toHaveBeenCalled()
    })

    test('returns null when modifyAction fails', async () => {
      mockExecutor.modifyAction.mockReturnValue({ success: false, error: 'built-in' })
      withCommand({
        command: 'modify_action',
        name: 'send_message',
        description: 'hacked'
      })

      await loop.runOnce()

      const recent = loop.status.recentActions
      expect(recent.some(r => r.includes('modify_action'))).toBe(false)
    })

    test('logs success in recentActions', async () => {
      withCommand({
        command: 'modify_action',
        name: 'my_action',
        code: 'await channel.send("new");'
      })

      await loop.runOnce()

      const recent = loop.status.recentActions
      expect(recent.some(r => r.includes('modify_action') && r.includes('my_action'))).toBe(true)
    })
  })

  // ─── delete_action ────────────────────────────────────────────────────────

  describe('delete_action command', () => {
    test('calls deleteAction with the given name', async () => {
      withCommand({ command: 'delete_action', name: 'my_action' })
      await loop.runOnce()
      expect(mockExecutor.deleteAction).toHaveBeenCalledWith('my_action')
    })

    test('returns null when name is missing', async () => {
      withCommand({ command: 'delete_action' })
      await loop.runOnce()
      expect(mockExecutor.deleteAction).not.toHaveBeenCalled()
    })

    test('returns null when deleteAction fails (not found)', async () => {
      mockExecutor.deleteAction.mockReturnValue({ success: false, error: 'not found' })
      withCommand({ command: 'delete_action', name: 'no_such_action' })
      await loop.runOnce()

      const recent = loop.status.recentActions
      expect(recent.some(r => r.includes('delete_action'))).toBe(false)
    })

    test('returns null when trying to delete a built-in', async () => {
      mockExecutor.deleteAction.mockReturnValue({ success: false, error: 'built-in action' })
      withCommand({ command: 'delete_action', name: 'send_poll' })
      await loop.runOnce()

      const recent = loop.status.recentActions
      expect(recent.some(r => r.includes('delete_action'))).toBe(false)
    })

    test('logs successful deletion in recentActions', async () => {
      withCommand({ command: 'delete_action', name: 'my_action' })
      await loop.runOnce()

      const recent = loop.status.recentActions
      expect(recent.some(r => r.includes('delete_action') && r.includes('my_action'))).toBe(true)
    })
  })
})
