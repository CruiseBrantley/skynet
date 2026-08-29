const createSlashCommand = require('../util/actions/create_slash_command')
const listSlashCommands = require('../util/actions/list_slash_commands')
const inspectSlashCommand = require('../util/actions/inspect_slash_command')
const commandManager = require('../util/commandManager')

jest.mock('../logger')

describe('Slash Command Dedicated Actions', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('list_slash_commands lists commands', async () => {
    jest.spyOn(commandManager, 'listSlashCommands').mockReturnValue([
      { name: 'test_cmd', enabled: true, scope: 'global' }
    ])

    const res = await listSlashCommands.execute({}, {}, {})
    expect(res).toContain('Slash Commands (1)')
    expect(res).toContain('/test_cmd')
  })

  test('inspect_slash_command inspects code', async () => {
    jest.spyOn(commandManager, 'inspectSlashCommand').mockReturnValue({
      success: true,
      name: 'test_cmd',
      enabled: true,
      content: 'module.exports = {}'
    })

    const res = await inspectSlashCommand.execute({}, {}, { name: 'test_cmd' })
    expect(res).toContain('Source code for "/test_cmd"')
    expect(res).toContain('module.exports = {}')
  })

  test('create_slash_command creates and deploys slash command', async () => {
    jest.spyOn(commandManager, 'createSlashCommand').mockResolvedValue({
      success: true,
      message: 'Created command'
    })

    const res = await createSlashCommand.execute({}, {}, {
      name: 'soundboard',
      description: 'Plays a sound',
      code: 'await interaction.reply("playing");'
    }, { userId: process.env.OWNER_ID })

    expect(res).toContain('Successfully created and deployed slash command "/soundboard"')
  })
})
