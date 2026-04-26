/**
 * Tests for chat.js autonomous command execution, specifically focusing on
 * correctly mocking subcommands (getSubcommand) to prevent crashes.
 */
const { MessageFlags } = require('discord.js')

// ----- Mocks ----------------------------------------------------------------
jest.mock('../util/ollama')
jest.mock('../logger')

const mockMemoryGetSummary = jest.fn().mockReturnValue(null)
jest.mock('../util/AgentMemory', () => ({
  getSummary: mockMemoryGetSummary
}))

const mockSchedulerAdd = jest.fn()
jest.mock('../util/AgentScheduler', () => ({
  add: mockSchedulerAdd,
  getAll: jest.fn().mockReturnValue([])
}))

const ActionExecutor = require('../util/ActionExecutor')
const mockExecuteAction = jest.spyOn(ActionExecutor, 'executeAction').mockResolvedValue({ success: true })
const mockListActions = jest.spyOn(ActionExecutor, 'listActions').mockImplementation(() => [
  { name: 'send_message', description: 'Send a message', schema: {} },
  { name: 'summarize_history', description: 'Summarize history', schema: {} }
])

const ollama = require('../util/ollama')
const chatCmd = require('../commands/chat')

function makeInteraction (message = 'test') {
  return {
    id: 'interaction-1',
    user: { tag: 'cruise#0001', username: 'cruise', id: 'user-999' },
    client: {
      user: { id: 'bot-id-000' },
      // We'll populate commands in the test
      commands: Object.assign(new Map(), {
        map: function (fn) {
          return Array.from(this.values()).map(fn)
        }
      })
    },
    guildId: 'guild-123',
    channelId: 'channel-abc',
    guild: {
      members: { cache: new Map() }
    },
    options: {
      getString: jest.fn().mockImplementation((n) => n === 'message' ? message : null),
      getAttachment: jest.fn(),
      attachments: { size: 0 }
    },
    deferReply: jest.fn(),
    editReply: jest.fn(),
    followUp: jest.fn(),
    deleteReply: jest.fn(),
    channel: { send: jest.fn() }
  }
}

describe('chat.js — Autonomous Subcommand Execution', () => {
  beforeEach(() => {
    ollama.queryOllamaWithContext.mockReset()
  })

  test('successfully executes a subcommand-based command without crashing', async () => {
    // 1. Define a mock command that uses getSubcommand
    const mockVoteExecute = jest.fn().mockImplementation(async (interaction) => {
      const sub = interaction.options.getSubcommand()
      await interaction.reply(`Executed subcommand: ${sub || 'none'}`)
    })

    const mockVoteCmd = {
      data: { name: 'vote', description: 'vote command description', options: [] },
      execute: mockVoteExecute
    }

    const interaction = makeInteraction('run vote list')
    interaction.client.commands.set('vote', mockVoteCmd)

    // 2. Mock Ollama to emit the autonomous command call
    ollama.queryOllamaWithContext
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '<<<RUN_COMMAND: {"command": "vote", "subcommand": "list"}>>>'
        }
      })
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: 'Autonomous command complete.'
        }
      })

    // 3. Execute chat command
    await chatCmd.execute(interaction)

    // 4. Assertions
    expect(mockVoteExecute).toHaveBeenCalled()
    const mockInteractionInstance = mockVoteExecute.mock.calls[0][0]

    // Verify getSubcommand exists and returns the correct value
    expect(typeof mockInteractionInstance.options.getSubcommand).toBe('function')
    expect(mockInteractionInstance.options.getSubcommand()).toBe('list')
  })

  test('handles missing subcommand gracefully (returns null)', async () => {
    const mockVoteExecute = jest.fn().mockImplementation(async (interaction) => {
      const sub = interaction.options.getSubcommand()
      await interaction.reply(`Result: ${sub}`)
    })

    const mockVoteCmd = {
      data: { name: 'vote', description: 'vote command description', options: [] },
      execute: mockVoteExecute
    }

    const interaction = makeInteraction('check votes')
    interaction.client.commands.set('vote', mockVoteCmd)

    ollama.queryOllamaWithContext
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '<<<RUN_COMMAND: {"command": "vote"}>>>'
        }
      })
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: 'Done.'
        }
      })

    await chatCmd.execute(interaction)

    expect(mockVoteExecute).toHaveBeenCalled()
    const mockInteractionInstance = mockVoteExecute.mock.calls[0][0]
    expect(mockInteractionInstance.options.getSubcommand()).toBeNull()
  })

  test('properly injects database dependency into autonomous commands', async () => {
    const mockDb = { ref: jest.fn().mockReturnValue({ once: jest.fn().mockResolvedValue({ val: () => [] }) }) }
    const mockExecute = jest.fn()
    const mockCmd = {
      data: { name: 'dbtest', description: 'test', options: [] },
      execute: mockExecute
    }

    const interaction = makeInteraction('run dbtest')
    interaction.client.commands.set('dbtest', mockCmd)

    ollama.queryOllamaWithContext
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '<<<RUN_COMMAND: {"command": "dbtest"}>>>'
        }
      })
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: 'Done.'
        }
      })

    // Pass mockDb as the second argument to execute
    await chatCmd.execute(interaction, mockDb)

    expect(mockExecute).toHaveBeenCalledWith(expect.anything(), mockDb)
  })
  test('properly handles wrapped params and fallback names', async () => {
    const mockExecute = jest.fn()
    const mockCmd = {
      data: { name: 'paramtest', description: 'test', options: [] },
      execute: mockExecute
    }

    const interaction = makeInteraction('run paramtest')
    interaction.client.commands.set('paramtest', mockCmd)

    ollama.queryOllamaWithContext
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '<<<RUN_COMMAND: {"command": "paramtest", "params": {"option": "wrapped_val"}}>>>'
        }
      })
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: 'Done.'
        }
      })

    await chatCmd.execute(interaction)

    expect(mockExecute).toHaveBeenCalled()
    const mockInteractionInstance = mockExecute.mock.calls[0][0]
    // Should find 'option' inside 'params' thanks to the new getParam() helper
    expect(mockInteractionInstance.options.getString('option')).toBe('wrapped_val')
    // Should also fall back to 'options' logic
    expect(mockInteractionInstance.options.getString('options')).toBe('wrapped_val')
  })

  test('normalizes boolean parameters correctly', async () => {
    const mockExecute = jest.fn()
    const mockCmd = {
      data: { name: 'booltest', description: 'test', options: [] },
      execute: mockExecute
    }

    const interaction = makeInteraction('run booltest')
    interaction.client.commands.set('booltest', mockCmd)

    ollama.queryOllamaWithContext
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '<<<RUN_COMMAND: {"command": "booltest", "enabled": "true", "visible": 1}>>>'
        }
      })
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: 'Done.'
        }
      })

    await chatCmd.execute(interaction)

    const mockInteractionInstance = mockExecute.mock.calls[0][0]
    expect(mockInteractionInstance.options.getBoolean('enabled')).toBe(true)
    expect(mockInteractionInstance.options.getBoolean('visible')).toBe(true)
    expect(mockInteractionInstance.options.getBoolean('missing')).toBe(false)
  })

  test('successfully falls back to ActionExecutor for dynamic actions', async () => {
    const mockInteraction = makeInteraction('test action')

    ollama.queryOllamaWithContext.mockResolvedValue({
      message: { role: 'assistant', content: '<<<RUN_COMMAND: {"command": "send_message", "content": "hello"}>>>' }
    })

    await chatCmd.execute(mockInteraction)

    // Verify ActionExecutor was called since 'send_message' is not in standard commands
    expect(mockExecuteAction).toHaveBeenCalledWith('send_message', expect.objectContaining({ content: 'hello' }), expect.anything())
  })
})
