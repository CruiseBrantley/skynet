const SkynetCore = require('../core/SkynetCore')
const IClientAdapter = require('../interfaces/IClientAdapter')
const NormalizedInteraction = require('../interfaces/NormalizedInteraction')

jest.mock('../logger')
jest.mock('../firebase-login', () => () => ({}))
jest.mock('../util/configSync', () => () => ({}))
jest.mock('../util/StateStore', () => ({ hydrate: jest.fn().mockResolvedValue() }))
jest.mock('../util/WorkflowEngine', () => ({ hydrate: jest.fn().mockResolvedValue() }))
jest.mock('../util/AgentMemory', () => ({ hydrate: jest.fn().mockResolvedValue() }))
jest.mock('../util/TriggerEngine', () => ({ hydrate: jest.fn().mockResolvedValue() }))
jest.mock('../util/AgentLoop', () => ({ start: jest.fn(), stop: jest.fn() }))
jest.mock('../util/AgentScheduler', () => ({ start: jest.fn(), stop: jest.fn() }))
jest.mock('../util/InstanceGuardian', () => ({ init: jest.fn().mockResolvedValue() }))

describe('SkynetCore', () => {
  let core

  beforeEach(() => {
    jest.clearAllMocks()
    core = new SkynetCore({ botName: 'TestSkynet' })
  })

  test('initializes and registers client adapters properly', async () => {
    await core.init()
    expect(core.isInitialized).toBe(true)

    class MockAdapter extends IClientAdapter {
      constructor () {
        super({ id: 'mock', name: 'Mock Adapter', capabilities: ['text'] })
        this.started = false
      }

      async start (c) {
        await super.start(c)
        this.started = true
      }
    }

    const adapter = new MockAdapter()
    await core.registerClient(adapter)

    expect(core.getClient('mock')).toBe(adapter)
    expect(adapter.started).toBe(true)
    expect(core.listClients()).toHaveLength(1)

    await core.unregisterClient('mock')
    expect(core.getClient('mock')).toBeUndefined()
  })

  test('dispatches dynamic button interactions to matching command buttonHandler', async () => {
    await core.init()

    const mockButtonHandler = jest.fn().mockResolvedValue()
    core.commands.set('soundboard', {
      buttonHandler: mockButtonHandler
    })

    const interaction = new NormalizedInteraction({
      clientId: 'discord',
      customId: 'soundboard_win',
      user: { id: 'user1', username: 'TestUser' }
    })

    await core.dispatchInteraction(interaction)
    expect(mockButtonHandler).toHaveBeenCalled()
  })
})
