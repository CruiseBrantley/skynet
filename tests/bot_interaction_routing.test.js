const { Client, Collection, GatewayIntentBits } = require('discord.js')
const logger = require('../logger')

jest.spyOn(process, 'exit').mockImplementation(() => {})
process.env.TOKEN = 'mock-token'

const discordJs = require('discord.js')
jest.spyOn(discordJs.Client.prototype, 'login').mockResolvedValue('mock-token')

// Mock all external modules to isolate bot.js
jest.mock('dotenv', () => ({ config: jest.fn() }))
jest.mock('child_process', () => ({ exec: jest.fn() }))
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readdirSync: jest.fn().mockReturnValue([]),
  readFileSync: jest.fn().mockReturnValue('{}'),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn()
}))
jest.mock('../server/server', () => ({ setupServer: jest.fn() }))
jest.mock('../firebase-login', () => jest.fn().mockReturnValue({}))
jest.mock('../util/configSync', () => jest.fn().mockReturnValue({}))
jest.mock('../util/InstanceGuardian', () => class { init() {} })
const mockMusicManager = { handleInteraction: jest.fn() }
jest.mock('../util/MusicManager', () => mockMusicManager)
jest.mock('../util/AgentScheduler', () => ({ processDueTasks: jest.fn() }))
jest.mock('../util/AgentLoop', () => ({ start: jest.fn() }))
jest.mock('../events/botUpdate', () => jest.fn().mockReturnValue(jest.fn()))
jest.mock('../events/botDelete', () => jest.fn().mockReturnValue(jest.fn()))
jest.mock('../util/chat/contextHelper', () => ({ fetchAndFormatContext: jest.fn() }))
jest.mock('../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}))

// Load bot.js after mocking
const bot = require('../bot.js')

describe('bot.js Interaction Routing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    bot.commands = new Collection()
  })

  test('routes server_ buttons to the server command handleButton', async () => {
    const mockHandleButton = jest.fn().mockResolvedValue()
    const mockServerCommand = { handleButton: mockHandleButton }
    bot.commands.set('server', mockServerCommand)

    const mockInteraction = {
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      customId: 'server_refresh_test',
      client: { commands: bot.commands }
    }

    // Trigger the interactionCreate event
    const interactionHandler = bot.listeners('interactionCreate')[0]
    await interactionHandler(mockInteraction)

    expect(mockHandleButton).toHaveBeenCalledWith(mockInteraction)
  })

  test('does not route random buttons to the server command', async () => {
    const mockHandleButton = jest.fn().mockResolvedValue()
    const mockServerCommand = { handleButton: mockHandleButton }
    bot.commands.set('server', mockServerCommand)

    const mockInteraction = {
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      customId: 'other_button',
      client: { commands: bot.commands }
    }

    const interactionHandler = bot.listeners('interactionCreate')[0]
    await interactionHandler(mockInteraction)

    expect(mockHandleButton).not.toHaveBeenCalled()
  })

  test('routes music_ buttons to musicManager.handleInteraction', async () => {
    const mockInteraction = {
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: 'music_pause',
      client: { commands: bot.commands }
    }

    const interactionHandler = bot.listeners('interactionCreate')[0]
    await interactionHandler(mockInteraction)

    expect(mockMusicManager.handleInteraction).toHaveBeenCalledWith(mockInteraction)
  })

  test('dynamically routes custom command buttons by prefix to handleButton or buttonHandler', async () => {
    const mockButtonHandler = jest.fn().mockResolvedValue()
    const mockSoundboardCommand = { buttonHandler: mockButtonHandler }
    bot.commands.set('soundboard', mockSoundboardCommand)

    const mockInteraction = {
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: 'soundboard_play_attack',
      client: { commands: bot.commands }
    }

    const interactionHandler = bot.listeners('interactionCreate')[0]
    await interactionHandler(mockInteraction)

    expect(mockButtonHandler).toHaveBeenCalledWith(mockInteraction, expect.anything())
  })
})
