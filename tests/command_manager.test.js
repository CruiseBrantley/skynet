const fs = require('fs')
const path = require('path')
const commandManager = require('../util/commandManager')
const manageCommandAction = require('../util/actions/manage_command')

jest.mock('../logger')
jest.mock('discord.js', () => {
  const actual = jest.requireActual('discord.js')
  return {
    ...actual,
    REST: jest.fn().mockImplementation(() => ({
      setToken: jest.fn().mockReturnThis(),
      put: jest.fn().mockResolvedValue([{ id: '1', name: 'chat' }])
    })),
    Routes: {
      applicationCommands: jest.fn().mockReturnValue('/app/commands'),
      applicationGuildCommands: jest.fn().mockReturnValue('/app/guild/commands')
    }
  }
})

describe('commandManager & manage_command action', () => {
  const originalEnv = process.env
  const mockBot = {
    commands: new Map([
      ['catfact', { data: { name: 'catfact' }, execute: jest.fn() }],
      ['server', { data: { name: 'server' }, execute: jest.fn() }]
    ])
  }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      TOKEN: 'mock-token',
      CLIENT_ID: 'mock-client-id',
      OWNER_ID: '104761687009189888'
    }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  test('lists slash commands correctly', () => {
    const list = commandManager.listSlashCommands()
    expect(Array.isArray(list)).toBe(true)
    const serverCmd = list.find(c => c.name === 'server')
    expect(serverCmd).toBeDefined()
    expect(serverCmd.protected).toBe(true)
    expect(serverCmd.enabled).toBe(true)
  })

  test('blocks disabling core protected commands (server, chat, config, ping)', async () => {
    const result = await commandManager.disableSlashCommand('server', mockBot)
    expect(result.success).toBe(false)
    expect(result.error).toContain('protected')
  })

  test('disables a command by renaming to .js.disabled, removing from bot.commands, and refreshing Discord', async () => {
    const testActive = path.join(__dirname, '../commands/test_disable_tmp.js')
    const testDisabled = path.join(__dirname, '../commands/test_disable_tmp.js.disabled')
    fs.writeFileSync(testActive, 'module.exports = { data: { name: "test_disable_tmp", toJSON: () => ({ name: "test_disable_tmp" }) }, execute: async () => {} };')

    try {
      const result = await commandManager.disableSlashCommand('test_disable_tmp', mockBot)
      expect(result.success).toBe(true)
      expect(result.message).toContain('Successfully disabled')
      expect(fs.existsSync(testDisabled)).toBe(true)
    } finally {
      if (fs.existsSync(testActive)) fs.unlinkSync(testActive)
      if (fs.existsSync(testDisabled)) fs.unlinkSync(testDisabled)
    }
  })

  test('enables a disabled command by renaming back to .js and registering', async () => {
    const testDisabled = path.join(__dirname, '../commands/test_enable_tmp.js.disabled')
    const testActive = path.join(__dirname, '../commands/test_enable_tmp.js')
    fs.writeFileSync(testDisabled, 'module.exports = { data: { name: "test_enable_tmp", toJSON: () => ({ name: "test_enable_tmp" }) }, execute: async () => {} };')

    try {
      const result = await commandManager.enableSlashCommand('test_enable_tmp', mockBot)
      expect(result.success).toBe(true)
      expect(result.message).toContain('Successfully enabled')
      expect(fs.existsSync(testActive)).toBe(true)
    } finally {
      if (fs.existsSync(testDisabled)) fs.unlinkSync(testDisabled)
      if (fs.existsSync(testActive)) fs.unlinkSync(testActive)
      try {
        delete require.cache[require.resolve(testActive)]
      } catch (_) {}
    }
  })

  test('manage_command action enforces owner security gate', async () => {
    const mockChannel = { send: jest.fn().mockResolvedValue({}) }

    const unauthorizedResult = await manageCommandAction.execute(
      mockBot,
      mockChannel,
      { action: 'disable', name: 'catfact' },
      { userId: 'unauthorized-user-999', guildId: 'guild-123' }
    )

    expect(unauthorizedResult.success).toBe(false)
    expect(unauthorizedResult.error).toContain('Permission denied')
    expect(mockChannel.send).toHaveBeenCalledWith(expect.stringContaining('Permission Denied'))
  })

  test('creates a new slash command, wraps with SlashCommandBuilder, and deploys to Discord', async () => {
    const testActive = path.join(__dirname, '../commands/test_create_tmp.js')

    try {
      const result = await commandManager.createSlashCommand({
        name: 'test_create_tmp',
        description: 'Temporary created slash command',
        code: 'await interaction.reply("Created command ran!");',
        bot: mockBot
      })

      expect(result.success).toBe(true)
      expect(result.message).toContain('Successfully created')
      expect(fs.existsSync(testActive)).toBe(true)
      const content = fs.readFileSync(testActive, 'utf8')
      expect(content).toContain('SlashCommandBuilder')
      expect(content).toContain('test_create_tmp')
    } finally {
      if (fs.existsSync(testActive)) fs.unlinkSync(testActive)
      try {
        delete require.cache[require.resolve(testActive)]
      } catch (_) {}
    }
  })

  test('blocks creating a slash command with forbidden patterns', async () => {
    const result = await commandManager.createSlashCommand({
      name: 'evil_cmd',
      description: 'Evil',
      code: 'require("child_process").exec("rm -rf /");',
      bot: mockBot
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Forbidden operation detected')
  })

  test('automatically infers and generates option chains from interaction.options.get* in code including required flag', async () => {
    const testActive = path.join(__dirname, '../commands/test_infer_options.js')

    try {
      const result = await commandManager.createSlashCommand({
        name: 'test_infer_options',
        description: 'Auto-inferred parameters',
        code: `
          const formula = interaction.options.getString('formula', true);
          const count = interaction.options.getInteger('count');
          const isSecret = interaction.options.getBoolean('secret', false);
          await interaction.reply('Done');
        `,
        bot: mockBot
      })

      expect(result.success).toBe(true)
      expect(fs.existsSync(testActive)).toBe(true)
      const content = fs.readFileSync(testActive, 'utf8')
      expect(content).toContain('.addStringOption(opt => opt.setName("formula").setDescription("formula option").setRequired(true))')
      expect(content).toContain('.addIntegerOption(opt => opt.setName("count").setDescription("count option").setRequired(false))')
      expect(content).toContain('.addBooleanOption(opt => opt.setName("secret").setDescription("secret option").setRequired(false))')
    } finally {
      if (fs.existsSync(testActive)) fs.unlinkSync(testActive)
      try {
        delete require.cache[require.resolve(testActive)]
      } catch (_) {}
    }
  })

  test('generates option chains from explicit options schema', async () => {
    const testActive = path.join(__dirname, '../commands/test_explicit_options.js')

    try {
      const result = await commandManager.createSlashCommand({
        name: 'test_explicit_options',
        description: 'Explicit parameters schema',
        options: [
          { name: 'formula', description: 'Dice formula (e.g. 2d6+3)', type: 'string', required: true },
          { name: 'sides', description: 'Number of sides', type: 'integer', required: false }
        ],
        code: 'await interaction.reply("Explicit params executed");',
        bot: mockBot
      })

      expect(result.success).toBe(true)
      expect(fs.existsSync(testActive)).toBe(true)
      const content = fs.readFileSync(testActive, 'utf8')
      expect(content).toContain('.addStringOption(opt => opt.setName("formula").setDescription("Dice formula (e.g. 2d6+3)").setRequired(true))')
      expect(content).toContain('.addIntegerOption(opt => opt.setName("sides").setDescription("Number of sides").setRequired(false))')
    } finally {
      if (fs.existsSync(testActive)) fs.unlinkSync(testActive)
      try {
        delete require.cache[require.resolve(testActive)]
      } catch (_) {}
    }
  })

  test('generates option chains from shorthand object schema', async () => {
    const testActive = path.join(__dirname, '../commands/test_shorthand_options.js')

    try {
      const result = await commandManager.createSlashCommand({
        name: 'test_shorthand_options',
        description: 'Shorthand parameters schema',
        options: {
          query: 'string — search query (required)',
          limit: 'int — max items'
        },
        code: 'await interaction.reply("Shorthand params executed");',
        bot: mockBot
      })

      expect(result.success).toBe(true)
      expect(fs.existsSync(testActive)).toBe(true)
      const content = fs.readFileSync(testActive, 'utf8')
      expect(content).toContain('.addStringOption(opt => opt.setName("query")')
      expect(content).toContain('.addIntegerOption(opt => opt.setName("limit")')
    } finally {
      if (fs.existsSync(testActive)) fs.unlinkSync(testActive)
      try {
        delete require.cache[require.resolve(testActive)]
      } catch (_) {}
    }
  })

  test('strips markdown code block fences generated by LLMs', async () => {
    const testActive = path.join(__dirname, '../commands/test_markdown_fences.js')

    try {
      const result = await commandManager.createSlashCommand({
        name: 'test_markdown_fences',
        description: 'Code wrapped in markdown',
        code: '```javascript\nconst query = interaction.options.getString("query");\nawait interaction.reply("Searched: " + query);\n```',
        bot: mockBot
      })

      expect(result.success).toBe(true)
      expect(fs.existsSync(testActive)).toBe(true)
      const content = fs.readFileSync(testActive, 'utf8')
      expect(content).not.toContain('```')
      expect(content).toContain('.addStringOption(opt => opt.setName("query")')
    } finally {
      if (fs.existsSync(testActive)) fs.unlinkSync(testActive)
      try {
        delete require.cache[require.resolve(testActive)]
      } catch (_) {}
    }
  })

  test('enforces Discord required-first parameter ordering when LLM lists optional before required', async () => {
    const testActive = path.join(__dirname, '../commands/test_required_order.js')

    try {
      const result = await commandManager.createSlashCommand({
        name: 'test_required_order',
        description: 'Required after optional',
        options: [
          { name: 'optional_tag', description: 'Tag', type: 'string', required: false },
          { name: 'required_target', description: 'Target', type: 'string', required: true }
        ],
        code: 'await interaction.reply("Ordered correctly");',
        bot: mockBot
      })

      expect(result.success).toBe(true)
      const content = fs.readFileSync(testActive, 'utf8')
      const reqIndex = content.indexOf('required_target')
      const optIndex = content.indexOf('optional_tag')
      // Required option MUST appear before optional option in the chain
      expect(reqIndex).toBeLessThan(optIndex)
    } finally {
      if (fs.existsSync(testActive)) fs.unlinkSync(testActive)
      try {
        delete require.cache[require.resolve(testActive)]
      } catch (_) {}
    }
  })

  test('sanitizes option names and truncates descriptions exceeding Discord limits', async () => {
    const testActive = path.join(__dirname, '../commands/test_sanitization.js')
    const longDesc = 'A'.repeat(200)

    try {
      const result = await commandManager.createSlashCommand({
        name: 'test_sanitization',
        description: 'Sanitized parameters',
        options: [
          { name: 'DICE TYPE!', description: longDesc, type: 'string', required: true }
        ],
        code: 'await interaction.reply("Sanitized");',
        bot: mockBot
      })

      expect(result.success).toBe(true)
      const content = fs.readFileSync(testActive, 'utf8')
      expect(content).toContain('.setName("dice_type_")')
      // Description must be capped at 100 characters
      expect(content).toContain('.setDescription("' + 'A'.repeat(100) + '")')
    } finally {
      if (fs.existsSync(testActive)) fs.unlinkSync(testActive)
      try {
        delete require.cache[require.resolve(testActive)]
      } catch (_) {}
    }
  })

  test('creates a guild-scoped slash command when guildId is provided', async () => {
    const testActive = path.join(__dirname, '../commands/test_guild_scoped.js')

    try {
      const result = await commandManager.createSlashCommand({
        name: 'test_guild_scoped',
        description: 'Guild scoped command',
        guildId: '987654321',
        code: 'await interaction.reply("Guild only");',
        bot: mockBot
      })

      expect(result.success).toBe(true)
      expect(fs.existsSync(testActive)).toBe(true)
      const content = fs.readFileSync(testActive, 'utf8')
      expect(content).toContain('guildId: "987654321"')
    } finally {
      if (fs.existsSync(testActive)) fs.unlinkSync(testActive)
      try {
        delete require.cache[require.resolve(testActive)]
      } catch (_) {}
    }
  })

  test('manage_command blocks non-admins in servers from creating commands', async () => {
    const mockChannel = { send: jest.fn().mockResolvedValue({}) }

    const createResult = await manageCommandAction.execute(
      mockBot,
      mockChannel,
      { action: 'create', name: 'unauthorized_cmd', description: 'desc', code: 'await interaction.reply("hi");' },
      { userId: 'regular-user-123', guildId: 'guild-456', memberPermissions: { has: () => false } }
    )

    expect(createResult.success).toBe(false)
    expect(createResult.error).toContain('Administrator or Manage Server')
    expect(mockChannel.send).toHaveBeenCalledWith(expect.stringContaining('Permission Denied'))
  })

  test('manage_command allows server admins to create guild-scoped slash commands', async () => {
    const mockChannel = { send: jest.fn().mockResolvedValue({}) }
    const createSpy = jest.spyOn(commandManager, 'createSlashCommand').mockResolvedValue({
      success: true,
      message: 'Created successfully'
    })

    const createResult = await manageCommandAction.execute(
      mockBot,
      mockChannel,
      { action: 'create', name: 'admin_server_cmd', description: 'Admin tool', code: 'await interaction.reply("Admin!");' },
      {
        userId: 'admin-user-789',
        guildId: '123456789',
        memberPermissions: { has: (perm) => true }
      }
    )

    expect(createResult.success).toBe(true)
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      name: 'admin_server_cmd',
      guildId: '123456789'
    }))
    expect(mockChannel.send).toHaveBeenCalledWith(expect.stringContaining('Created successfully'))

    createSpy.mockRestore()
  })

  test('manage_command action blocks non-owners from disabling slash commands', async () => {
    const mockChannel = { send: jest.fn().mockResolvedValue({}) }

    const disableResult = await manageCommandAction.execute(
      mockBot,
      mockChannel,
      { action: 'disable', name: 'roll' },
      { userId: '999999999999999999', guildId: '123456789' }
    )

    expect(disableResult.success).toBe(false)
    expect(disableResult.error).toContain('restricted to the bot creator')
    expect(mockChannel.send).toHaveBeenCalledWith(expect.stringContaining('Permission Denied'))
  })
})
