const AgentTurnManager = require('../util/chat/AgentTurnManager')
const ActionExecutor = require('../util/ActionExecutor')

jest.mock('../logger')
jest.mock('../util/telemetry', () => ({
  trackCommandExecution: jest.fn().mockResolvedValue()
}))

describe('Agent Peer Capabilities Suite', () => {
  let turnManager
  let mockInteraction

  beforeEach(() => {
    jest.clearAllMocks()
    turnManager = new AgentTurnManager({ botName: 'Skynet' })

    mockInteraction = {
      guildId: 'guild-123',
      channelId: 'chan-456',
      user: { id: 'user-789', tag: 'user#0001', username: 'user' },
      client: {
        user: { id: 'bot-000' },
        commands: new Map()
      },
      channel: {
        id: 'chan-456',
        send: jest.fn().mockResolvedValue({})
      },
      deferReply: jest.fn().mockResolvedValue({}),
      editReply: jest.fn().mockResolvedValue({}),
      followUp: jest.fn().mockResolvedValue({}),
      deleteReply: jest.fn().mockResolvedValue({})
    }
  })

  test('1. ActionExecutor.getOllamaToolsSchema generates valid OpenAI/Ollama function calling schemas', () => {
    const schemas = ActionExecutor.getOllamaToolsSchema({ isOwner: true, isPrivate: true })
    expect(Array.isArray(schemas)).toBe(true)
    expect(schemas.length).toBeGreaterThan(0)

    const hostExec = schemas.find(s => s.function.name === 'host_exec')
    expect(hostExec).toBeDefined()
    expect(hostExec.type).toBe('function')
    expect(hostExec.function.name).toBe('host_exec')
    expect(hostExec.function.parameters.type).toBe('object')
    expect(hostExec.function.parameters.properties.command).toBeDefined()
  })

  test('2. extractToolCalls extracts native tool_calls from responseData cleanly', () => {
    const responseData = {
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'read_system_file',
              arguments: { file_path: 'frontend/index.html' }
            }
          }
        ]
      }
    }

    const calls = turnManager.extractToolCalls('', responseData)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('read_system_file')
    expect(calls[0].arguments.file_path).toBe('frontend/index.html')
  })

  test('3. sanitizeObservation strips ANSI escape codes and truncates oversized output safely', () => {
    const rawAnsi = '\u001b[31mError:\u001b[0m \u001b[32mBuild failed\u001b[0m'
    const cleaned = AgentTurnManager.sanitizeObservation(rawAnsi)
    expect(cleaned).toBe('Error: Build failed')

    const hugeText = 'A'.repeat(5000)
    const truncated = AgentTurnManager.sanitizeObservation(hugeText, { maxLength: 1000 })
    expect(truncated.length).toBeLessThan(1200)
    expect(truncated).toContain('Output Truncated')
    expect(truncated.startsWith('A'.repeat(500))).toBe(true)
  })

  test('4. evaluatePendingWork flags ungrounded responses when tools retrieved data', async () => {
    turnManager.queryOllamaWithContext = jest.fn().mockResolvedValue({
      message: {
        role: 'assistant',
        content: JSON.stringify({
          is_sufficient: false,
          reason: 'Grounding failure: Assistant ignored retrieved files and gave generic non-answer',
          suggested_action: 'Synthesize answer citing the files found in tool observation'
        })
      }
    })

    const evalResult = await turnManager.evaluatePendingWork({
      ollamaContext: {},
      executedTools: [{ name: 'host_exec' }],
      assistantText: 'I do not know what files are in frontend/public.',
      channelHistory: {
        messages: [{ role: 'user', content: 'What is inside frontend/public?' }]
      }
    })

    expect(evalResult.isSufficient).toBe(false)
    expect(evalResult.isPending).toBe(true)
    expect(evalResult.reason).toContain('Grounding failure')
  })

  test('5. executeTurn enters dedicated STATE_SYNTHESIZE when tools execute but model produces empty text', async () => {
    const mockQuery = jest.fn()
      // Step 1: Model calls tool natively
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            function: {
              name: 'read_state',
              arguments: { key: 'status_key' }
            }
          }]
        }
      })
      // Step 2: Model finishes tool phase with empty text -> triggers synthesis turn
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: ''
        }
      })
      // Step 2b: Dedicated synthesis turn generates final grounded answer
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: 'The current status in state is operational.'
        }
      })
      // Coordinator evaluation confirming completion
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: JSON.stringify({ is_sufficient: true, reason: 'Grounded complete answer' })
        }
      })

    turnManager.queryOllamaWithContext = mockQuery

    const channelHistory = {
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Check state status' }
      ]
    }

    const result = await turnManager.executeTurn({
      interaction: mockInteraction,
      database: {},
      channelHistory,
      ollamaContext: {}
    })

    expect(result.success).toBe(true)
    expect(result.replyContent).toBe('The current status in state is operational.')
    expect(result.executedTools).toHaveLength(1)
    expect(result.executedTools[0].name).toBe('read_state')
  })
})
