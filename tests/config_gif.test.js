const config = require('../commands/config')

jest.mock('../logger')

describe('Config Command - GIF Subcommand', () => {
  let mockInteraction
  let mockDatabase

  beforeEach(() => {
    jest.clearAllMocks()

    mockDatabase = {
      ref: jest.fn().mockReturnThis(),
      update: jest.fn().mockResolvedValue(),
      once: jest.fn().mockResolvedValue({
        val: jest.fn().mockReturnValue('anime')
      })
    }

    mockInteraction = {
      guildId: 'guild-123',
      user: { id: 'owner-id' },
      member: {
        permissions: {
          has: jest.fn().mockReturnValue(true) // Administrator
        }
      },
      options: {
        getSubcommand: jest.fn().mockReturnValue('gif'),
        getString: jest.fn().mockImplementation((name) => {
          if (name === 'theme') return 'anime'
          if (name === 'server_id') return null
          return null
        })
      },
      reply: jest.fn().mockResolvedValue()
    }
  })

  test('should update GIF theme to anime in Firebase and reply with Embed', async () => {
    await config.execute(mockInteraction, mockDatabase)

    expect(mockDatabase.ref).toHaveBeenCalledWith('guild_settings/guild-123')
    expect(mockDatabase.update).toHaveBeenCalledWith({ gif_theme: 'anime' })
    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }))
  })

  test('should respect server_id override if provided (Owner only)', async () => {
    mockInteraction.options.getString.mockImplementation((name) => {
      if (name === 'theme') return 'disabled'
      if (name === 'server_id') return '111277280432508928'
      return null
    })

    process.env.OWNER_ID = 'owner-id'

    await config.execute(mockInteraction, mockDatabase)

    expect(mockDatabase.ref).toHaveBeenCalledWith('guild_settings/111277280432508928')
    expect(mockDatabase.update).toHaveBeenCalledWith({ gif_theme: 'disabled' })
  })

  test('should block non-admins from changing GIF settings', async () => {
    mockInteraction.member.permissions.has.mockReturnValue(false)
    process.env.OWNER_ID = 'different-owner-id'

    await config.execute(mockInteraction, mockDatabase)

    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'You do not have permission to manage bot configuration.',
      ephemeral: true
    }))
    expect(mockDatabase.update).not.toHaveBeenCalled()
  })
})
