// Mock environment variables before importing the command
process.env.STEAM_SSH_HOST = 'user@1.2.3.4'
process.env.STEAM_SSH_KEY = 'key_path'
process.env.STEAM_STEAMCMD_PATH = 'steamcmd_path'

jest.mock('child_process')
jest.mock('dgram')
jest.mock('../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}))

const { execFile } = require('child_process')
const dgram = require('dgram')
const { PermissionFlagsBits } = require('discord.js')

// Now import the command
const serverCommand = require('../commands/server')

// ── Helpers ──

function mockInteraction ({
  subcommand = 'status',
  name = 'icarus',
  guildId = '111277280432508928',
  isAdmin = true,
  force = false
} = {}) {
  return {
    guildId,
    member: {
      permissions: {
        has: jest.fn().mockReturnValue(isAdmin)
      }
    },
    options: {
      getSubcommand: jest.fn().mockReturnValue(subcommand),
      getString: jest.fn().mockReturnValue(name),
      getBoolean: jest.fn().mockReturnValue(force)
    },
    deferReply: jest.fn().mockResolvedValue(),
    editReply: jest.fn().mockResolvedValue()
  }
}

function stubSSH (stubs) {
  let callIndex = 0
  execFile.mockImplementation((bin, args, opts, cb) => {
    const stub = stubs[callIndex++]
    if (!stub) return cb(null, '', '')
    cb(null, stub.stdout || '', stub.stderr || '')
  })
}

function stubServerInfo (info) {
  const mockSocket = {
    on: jest.fn(),
    close: jest.fn(),
    send: jest.fn((query, port, host, cb) => {
      if (cb) cb()
      if (info) {
        const onMessageCall = mockSocket.on.mock.calls.find(c => c[0] === 'message')
        if (onMessageCall) {
          const onMessage = onMessageCall[1]
          const header = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0x49, 0x11])
          const sName = Buffer.from((info.name || 'Server') + '\0')
          const sMap = Buffer.from((info.map || 'Map') + '\0')
          const folder = Buffer.from('folder\0')
          const game = Buffer.from('game\0')
          const rest = Buffer.from([
            0x01, 0x00,
            info.players || 0,
            info.maxPlayers || 16,
            0x00, 0x64, 0x77, 0x00, 0x01
          ])
          const version = Buffer.from((info.version || '1.0') + '\0')
          const fakeMsg = Buffer.concat([header, sName, sMap, folder, game, rest, version])
          onMessage(fakeMsg)
        }
      }
    })
  }
  dgram.createSocket.mockReturnValue(mockSocket)
}

// ── Tests ──

describe('server command enhanced tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('status subcommand', () => {
    test('shows rich embed with player stats and resources', async () => {
      const interaction = mockInteraction({ subcommand: 'status' })
      stubServerInfo({
        name: 'Test Server',
        map: 'Olympus',
        players: 5,
        maxPlayers: 16,
        version: '1.2.3.4'
      })

      // Fixed process name to match config/steam_apps.json: IcarusServer-Win64-Shipping.exe
      stubSSH([
        { stdout: '"IcarusServer-Win64-Shipping.exe","1234","Services","0","550,120 K"' }
      ])

      await serverCommand.execute(interaction)

      const lastCall = interaction.editReply.mock.calls[0][0]
      const embed = lastCall.embeds[0].data

      expect(embed.title).toBe('Icarus Server Status')
      expect(embed.fields.find(f => f.name === 'Players').value).toBe('`5 / 16`')
      expect(embed.fields.find(f => f.name === 'Memory').value).toBe('`550,120 K`')
    })
  })

  describe('update subcommand', () => {
    test('uses playerCount from getServerInfo for restart protection', async () => {
      const interaction = mockInteraction({ subcommand: 'update', isAdmin: false })
      stubServerInfo({ players: 3 })

      await serverCommand.execute(interaction)

      // Check all calls to see if any contain the expected error message
      const calls = interaction.editReply.mock.calls
      const hasError = calls.some(call =>
        call[0].embeds &&
                call[0].embeds[0].data.description.includes('currently **3** player(s) online')
      )
      expect(hasError).toBe(true)
    })
  })
})
