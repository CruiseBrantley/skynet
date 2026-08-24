const fs = require('fs')
const path = require('path')
const commandManager = require('../util/commandManager')
const manageCommandAction = require('../util/actions/manage_command')

jest.mock('../logger')

describe('Command Scope Management & Visibility', () => {
  const originalOwnerId = process.env.OWNER_ID
  const DUMMY_CMD_PATH = path.join(__dirname, '../commands/dummy_scope_test.js')

  beforeAll(() => {
    process.env.OWNER_ID = 'owner-12345'
  })

  afterAll(() => {
    process.env.OWNER_ID = originalOwnerId
    if (fs.existsSync(DUMMY_CMD_PATH)) fs.unlinkSync(DUMMY_CMD_PATH)
  })

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(commandManager, 'deploySlashCommands').mockResolvedValue({ success: true, count: 1 })
  })

  test('listSlashCommands includes explicit scope tags', () => {
    const list = commandManager.listSlashCommands()
    expect(list.length).toBeGreaterThan(0)
    for (const cmd of list) {
      expect(cmd.scope).toBeDefined()
      expect(['global', 'guild', 'disabled']).toContain(cmd.scope)
    }
  })

  test('setCommandScope updates command guildId on disk and redeploys', async () => {
    const initialCode = 'module.exports = {\n  data: { name: "dummy_scope_test" },\n  execute: async () => {}\n};\n'
    fs.writeFileSync(DUMMY_CMD_PATH, initialCode, 'utf8')

    // Set scope to specific guild
    const scopeRes = await commandManager.setCommandScope({
      name: 'dummy_scope_test',
      guildId: 'guild-777',
      bot: { commands: new Map() }
    })

    expect(scopeRes.success).toBe(true)
    expect(scopeRes.scope).toBe('guild-777')
    expect(commandManager.deploySlashCommands).toHaveBeenCalled()

    // Verify on disk
    const diskContent = fs.readFileSync(DUMMY_CMD_PATH, 'utf8')
    expect(diskContent).toContain("guildId: 'guild-777'")

    // Set scope back to global
    const globalRes = await commandManager.setCommandScope({
      name: 'dummy_scope_test',
      guildId: 'global',
      bot: { commands: new Map() }
    })

    expect(globalRes.success).toBe(true)
    expect(globalRes.scope).toBe('global')
    const globalContent = fs.readFileSync(DUMMY_CMD_PATH, 'utf8')
    expect(globalContent).not.toContain("guildId: 'guild-777'")
  })

  test('manage_command action list embeds include scope tags', async () => {
    const mockSend = jest.fn().mockResolvedValue({})
    const mockChannel = { send: mockSend }

    const res = await manageCommandAction.execute({}, mockChannel, { action: 'list' }, { userId: 'owner-12345' })
    expect(res.success).toBe(true)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            title: '⚙️ Slash Command Registry & Scopes'
          })
        })
      ])
    }))
  })
})
