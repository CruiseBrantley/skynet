const AutonomousCommandProcessor = require('../util/chat/AutonomousCommandProcessor')
const actionExecutor = require('../util/ActionExecutor')
const selfHealing = require('../util/chat/SelfHealingEngine')

jest.mock('../logger')

describe('Dynamic Action Synthesis & Self-Healing Integration', () => {
  let processor
  let mockInteraction
  let mockChannelHistory
  let mockSharedState
  let mockOllamaContext

  beforeEach(() => {
    jest.clearAllMocks()

    processor = new AutonomousCommandProcessor({
      botName: 'Skynet',
      ActionExecutor: actionExecutor,
      agentMemory: { set: jest.fn(), get: jest.fn(), delete: jest.fn() },
      queryOllamaWithContext: jest.fn().mockResolvedValue({ message: { role: 'assistant', content: 'Action registered and executed.' } }),
      getParam: jest.fn()
    })

    mockInteraction = {
      user: { id: 'user-1' },
      channel: {
        id: 'chan-1',
        send: jest.fn().mockResolvedValue({ id: 'msg-1' }),
        sendTyping: jest.fn()
      },
      client: {
        commands: new Map()
      },
      editReply: jest.fn().mockResolvedValue({})
    }

    mockChannelHistory = {
      messages: [{ role: 'user', content: 'Create a custom coin flip action' }]
    }

    mockSharedState = {
      primaryResponseUsed: false,
      highImpactCount: 0,
      visualActionExecuted: false
    }

    mockOllamaContext = {}
  })

  test('creates and registers a dynamic action via create_action in chat', async () => {
    const registerSpy = jest.spyOn(actionExecutor, 'registerAction').mockReturnValue({ success: true })

    const replyContent = '<<<RUN_COMMAND: {"command": "create_action", "name": "flip_coin", "description": "Flips a coin", "schema": {}, "code": "await channel.send(Math.random() > 0.5 ? \'Heads\' : \'Tails\');"}>>>'

    await processor.process({
      interaction: mockInteraction,
      database: null,
      channelHistory: mockChannelHistory,
      replyContent,
      sharedState: mockSharedState,
      ollamaContext: mockOllamaContext
    })

    expect(registerSpy).toHaveBeenCalledWith(
      'flip_coin',
      'Flips a coin',
      {},
      "await channel.send(Math.random() > 0.5 ? 'Heads' : 'Tails');"
    )
    expect(mockChannelHistory.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('Successfully created and registered dynamic action "flip_coin"')
        })
      ])
    )

    registerSpy.mockRestore()
  })

  test('modifies an existing dynamic action via modify_action in chat', async () => {
    const modifySpy = jest.spyOn(actionExecutor, 'modifyAction').mockReturnValue({ success: true })

    const replyContent = '<<<RUN_COMMAND: {"command": "modify_action", "name": "flip_coin", "description": "Flips weighted coin", "code": "await channel.send(\'Heads\');"}>>>'

    await processor.process({
      interaction: mockInteraction,
      database: null,
      channelHistory: mockChannelHistory,
      replyContent,
      sharedState: mockSharedState,
      ollamaContext: mockOllamaContext
    })

    expect(modifySpy).toHaveBeenCalledWith(
      'flip_coin',
      expect.objectContaining({
        description: 'Flips weighted coin',
        code: "await channel.send('Heads');"
      })
    )

    modifySpy.mockRestore()
  })

  test('deletes a dynamic action via delete_action in chat', async () => {
    const deleteSpy = jest.spyOn(actionExecutor, 'deleteAction').mockReturnValue({ success: true })

    const replyContent = '<<<RUN_COMMAND: {"command": "delete_action", "name": "flip_coin"}>>>'

    await processor.process({
      interaction: mockInteraction,
      database: null,
      channelHistory: mockChannelHistory,
      replyContent,
      sharedState: mockSharedState,
      ollamaContext: mockOllamaContext
    })

    expect(deleteSpy).toHaveBeenCalledWith('flip_coin')

    deleteSpy.mockRestore()
  })

  test('actionExecutor automatically invokes selfHealing on dynamic action failure and retries', async () => {
    const healSpy = jest.spyOn(selfHealing, 'healAction').mockResolvedValue({
      success: true,
      fixedCode: 'return "Fixed Output";',
      reasoning: 'Fixed syntax error'
    })

    const fs = require('fs')
    const path = require('path')
    const customDir = path.join(__dirname, '../data/agent_actions')
    const testFile = path.join(customDir, 'test_fail_action.js')

    const mockAction = {
      name: 'test_fail_action',
      description: 'Test action',
      schema: {},
      execute: jest.fn()
        .mockRejectedValueOnce(new Error('Initial runtime failure'))
        .mockResolvedValueOnce('Success after heal')
    }

    actionExecutor._actions.test_fail_action = mockAction

    const existsSpy = jest.spyOn(fs, 'existsSync').mockImplementation((p) => p === testFile)
    const readSpy = jest.spyOn(fs, 'readFileSync').mockReturnValue(`
      module.exports = {
        name: "test_fail_action",
        description: "Test action",
        schema: {},
        execute: async (bot, channel, params) => {
          throw new Error('Initial runtime failure');
        }
      };
    `)

    const result = await actionExecutor.executeAction('test_fail_action', { test: 123 }, { client: {}, channel: mockInteraction.channel })

    expect(healSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: 'test_fail_action',
        error: expect.any(Error)
      })
    )
    expect(result.success).toBe(true)
    expect(result.output).toBe('Success after heal')
    expect(result.healed).toBe(true)

    healSpy.mockRestore()
    existsSpy.mockRestore()
    readSpy.mockRestore()
    delete actionExecutor._actions.test_fail_action
  })
})
