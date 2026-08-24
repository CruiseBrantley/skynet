const stateStore = require('../util/StateStore')
const workflowEngine = require('../util/WorkflowEngine')
const triggerEngine = require('../util/TriggerEngine')
const agentMemory = require('../util/AgentMemory')

jest.mock('../logger')

describe('Firebase Cloud Sync Bridge for Autonomous Stores', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    stateStore._state.clear()
    workflowEngine._workflows = []
    triggerEngine._triggers = []
    agentMemory._data = {}
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('StateStore hydrates from Firebase and syncs changes with debouncing', async () => {
    const mockSet = jest.fn().mockResolvedValue()
    const mockRef = {
      once: jest.fn().mockResolvedValue({
        exists: () => true,
        val: () => ({ remote_key: { value: 'remote_val' } })
      }),
      set: mockSet
    }
    const mockDb = { ref: jest.fn().mockReturnValue(mockRef) }

    stateStore.init(mockDb)
    await Promise.resolve()

    expect(stateStore.get('remote_key')).toBe('remote_val')

    // Local mutation triggers debounced sync
    stateStore.set('local_key', 'local_val')
    jest.advanceTimersByTime(600)

    expect(mockDb.ref).toHaveBeenCalledWith('operational_state')
    expect(mockSet).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'remote_key' }),
      expect.objectContaining({ key: 'local_key' })
    ]))
  })

  test('WorkflowEngine hydrates from Firebase and syncs mutations', async () => {
    const mockSet = jest.fn().mockResolvedValue()
    const mockRef = {
      once: jest.fn().mockResolvedValue({
        exists: () => true,
        val: () => [{ id: 'wf_remote', name: 'remote_wf', steps: [] }]
      }),
      set: mockSet
    }
    const mockDb = { ref: jest.fn().mockReturnValue(mockRef) }

    workflowEngine.init(mockDb)
    await Promise.resolve()

    expect(workflowEngine.getWorkflow('wf_remote')).toBeDefined()

    workflowEngine.createWorkflow({ name: 'new_wf', steps: [{ name: 's1', action: 'add_reaction' }] })
    jest.advanceTimersByTime(600)

    expect(mockDb.ref).toHaveBeenCalledWith('agent_workflows')
    expect(mockSet).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: 'remote_wf' }),
      expect.objectContaining({ name: 'new_wf' })
    ]))
  })

  test('TriggerEngine hydrates from Firebase and syncs mutations', async () => {
    const mockSet = jest.fn().mockResolvedValue()
    const mockRef = {
      once: jest.fn().mockResolvedValue({
        exists: () => true,
        val: () => [{ id: 'trig_remote', conditionType: 'command_error_streak', threshold: 3 }]
      }),
      set: mockSet
    }
    const mockDb = { ref: jest.fn().mockReturnValue(mockRef) }

    triggerEngine.init({ database: mockDb })
    await Promise.resolve()

    expect(triggerEngine.listTriggers().some(t => t.id === 'trig_remote')).toBe(true)

    triggerEngine.addTrigger({ conditionType: 'host_ram', threshold: 90 })
    jest.advanceTimersByTime(600)

    expect(mockDb.ref).toHaveBeenCalledWith('agent_triggers')
    expect(mockSet).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'trig_remote' }),
      expect.objectContaining({ conditionType: 'host_ram' })
    ]))
  })

  test('AgentMemory hydrates from Firebase and syncs memories', async () => {
    const mockSet = jest.fn().mockResolvedValue()
    const mockRef = {
      once: jest.fn().mockResolvedValue({
        exists: () => true,
        val: () => ({ 'user.preferred_name': { value: 'Sirian', updatedAt: Date.now(), ttlDays: -1 } })
      }),
      set: mockSet
    }
    const mockDb = { ref: jest.fn().mockReturnValue(mockRef) }

    agentMemory.init(mockDb)
    await Promise.resolve()

    expect(agentMemory.get('user.preferred_name')).toBe('Sirian')

    agentMemory.set('user.game', 'Diablo 4')
    jest.advanceTimersByTime(600)

    expect(mockDb.ref).toHaveBeenCalledWith('agent_memory')
    expect(mockSet).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'user.preferred_name' }),
      expect.objectContaining({ key: 'user.game' })
    ]))
  })
})
