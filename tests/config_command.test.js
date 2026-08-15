const configCmd = require('../commands/config')

jest.mock('../logger')
jest.mock('../util/AgentMemory')

describe('commands/config', () => {
  let mockInteraction

  beforeEach(() => {
    mockInteraction = {
      guildId: 'guild_123',
      user: { username: 'testuser' },
      member: {
        permissions: {
          has: jest.fn().mockReturnValue(true)
        }
      },
      options: {
        getSubcommand: jest.fn(),
        getString: jest.fn(),
        getBoolean: jest.fn()
      },
      reply: jest.fn().mockResolvedValue()
    }
  })

  test('executes status subcommand', async () => {
    mockInteraction.options.getSubcommand.mockReturnValue('status')
    await configCmd.execute(mockInteraction)

    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
      ephemeral: true
    }))
  })

  test('executes proactive subcommand', async () => {
    mockInteraction.options.getSubcommand.mockReturnValue('proactive')
    mockInteraction.options.getBoolean.mockImplementation((name) => {
      if (name === 'presence') return true
      if (name === 'reactions') return false
      return null
    })
    mockInteraction.options.getString.mockReturnValue('general, gaming')

    await configCmd.execute(mockInteraction)

    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Updated proactive chat presence'),
      ephemeral: true
    }))
  })

  test('executes patch-notes subcommand', async () => {
    mockInteraction.options.getSubcommand.mockReturnValue('patch-notes')
    mockInteraction.options.getBoolean.mockReturnValue(true)
    mockInteraction.options.getString.mockReturnValue('#game-news')

    await configCmd.execute(mockInteraction)

    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Updated proactive game patch notes'),
      ephemeral: true
    }))
  })
})
