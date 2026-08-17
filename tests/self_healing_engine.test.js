const selfHealing = require('../util/chat/SelfHealingEngine')
const { queryCodeCapableModel } = require('../util/ollama')
const actionExecutor = require('../util/ActionExecutor')
const agentMemory = require('../util/AgentMemory')

jest.mock('../util/ollama')
jest.mock('../logger')

describe('SelfHealingEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('successfully diagnoses error, patches action, and records fix in memory', async () => {
    const mockRegister = jest.spyOn(actionExecutor, 'registerAction').mockReturnValue({ success: true })
    const mockMemorySet = jest.spyOn(agentMemory, 'set').mockReturnValue(true)

    queryCodeCapableModel.mockResolvedValueOnce({
      message: {
        content: JSON.stringify({
          reasoning: 'Fixed missing await on channel.send and corrected parameter access.',
          fixed_code: 'await channel.send("Roll: " + (params.dice || "1d20"));'
        })
      }
    })

    const result = await selfHealing.healAction({
      actionName: 'roll_dice',
      description: 'Rolls custom dice',
      schema: { dice: 'string' },
      code: 'channel.send("Roll: " + param.dice);',
      error: new Error('param is not defined'),
      params: { dice: '2d6' }
    })

    expect(result.success).toBe(true)
    expect(result.fixedCode).toContain('await channel.send')
    expect(result.reasoning).toContain('Fixed missing await')
    expect(mockRegister).toHaveBeenCalledWith(
      'roll_dice',
      'Rolls custom dice',
      { dice: 'string' },
      'await channel.send("Roll: " + (params.dice || "1d20"));'
    )
    expect(mockMemorySet).toHaveBeenCalledWith(
      'self_improvement.fixes.roll_dice',
      expect.objectContaining({ error: 'param is not defined' }),
      30
    )

    mockRegister.mockRestore()
    mockMemorySet.mockRestore()
  })

  test('handles model returning invalid JSON or malformed code', async () => {
    queryCodeCapableModel.mockResolvedValueOnce({
      message: {
        content: 'I fixed it: just do channel.send()'
      }
    })

    const result = await selfHealing.healAction({
      actionName: 'broken_action',
      code: 'throw new Error();',
      error: new Error('Fatal error')
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('JSON')
  })

  test('rejects patched code containing forbidden patterns (fs, child_process, process.env)', async () => {
    queryCodeCapableModel.mockResolvedValueOnce({
      message: {
        content: JSON.stringify({
          reasoning: 'Malicious or invalid patch',
          fixed_code: 'require("child_process").exec("rm -rf /");'
        })
      }
    })

    const result = await selfHealing.healAction({
      actionName: 'malicious_action',
      code: 'throw new Error();',
      error: new Error('Execution failed')
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Forbidden operation detected')
  })
})
