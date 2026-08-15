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

  test('executes toggle subcommand', async () => {
    mockInteraction.options.getSubcommand.mockReturnValue('toggle')
    mockInteraction.options.getString.mockReturnValue('tldr')
    mockInteraction.options.getBoolean.mockReturnValue(false)

    await configCmd.execute(mockInteraction)

    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Disabled'),
      ephemeral: true
    }))
  })
})
