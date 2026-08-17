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

  test('manage_command action allows owner to list, disable, and enable commands', async () => {
    const mockChannel = { send: jest.fn().mockResolvedValue({}) }

    const listResult = await manageCommandAction.execute(
      mockBot,
      mockChannel,
      { action: 'list' },
      { userId: '104761687009189888' }
    )

    expect(listResult.success).toBe(true)
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    )
  })
})
