const fs = require('fs')
const path = require('path')
const readSystemFile = require('../util/actions/read_system_file')

describe('read_system_file Action', () => {
  const TEST_ENV_PATH = path.join(__dirname, '../.env.test_mock')

  beforeAll(() => {
    const mockEnv = `
# Environment Config
CLIENT_ID=1234567890
GUILD_ID=111277280432508928
OWNER_ID=199749017150816256
NODE_ENV=production
PORT=3000
TOKEN=NzM1MTI5NDc1OTMwMDE3Mzk2NQ.G_SuperSecretTokenString123456
GEMINI_API_KEY=AIzaSyD_MySuperSecretGeminiKey999
TWITCH_CLIENT_SECRET=SecretTwitchValue987654321
DATABASE_URL=https://my-secret-db.firebaseio.com
`
    fs.writeFileSync(TEST_ENV_PATH, mockEnv, 'utf8')
  })

  afterAll(() => {
    if (fs.existsSync(TEST_ENV_PATH)) fs.unlinkSync(TEST_ENV_PATH)
  })

  test('reads and inspects config files successfully', async () => {
    const res = await readSystemFile.execute({}, {}, { file_path: 'config/steam_apps.json' })
    expect(res).toContain('[SYSTEM: File Content for "config/steam_apps.json"')
    expect(res).toContain('icarus')
  })

  test('tails log files with line limiting', async () => {
    const res = await readSystemFile.execute({}, {}, { file_path: 'logs/combined.log', lines: 10 })
    expect(res).toContain('[SYSTEM: Log Tail for "logs/combined.log"')
  })

  test('redacts sensitive secrets in .env file', async () => {
    const res = await readSystemFile.execute({}, {}, { file_path: '.env' })
    expect(res).toContain('[SYSTEM: Environment Configuration for ".env" (Secrets Redacted):')
    // Ensure sensitive values are redacted
    expect(res).not.toContain('G_SuperSecretTokenString')
    expect(res).not.toContain('AIzaSyD_')
    expect(res).toContain('TOKEN=[REDACTED_SECRET:')
    expect(res).toContain('GEMINI_API_KEY=[REDACTED_SECRET:')
    // Ensure non-sensitive keys remain visible
    expect(res).toContain('CLIENT_ID=')
    expect(res).toContain('OWNER_ID=')
  })

  test('reads and inspects logic files in util, commands, server, core, and frontend', async () => {
    const resUtil = await readSystemFile.execute({}, {}, { file_path: 'commands/twitch-notify.js' })
    expect(resUtil).toContain('[SYSTEM: File Content for "commands/twitch-notify.js"')
    expect(resUtil).toContain('twitch-notify')

    const resCore = await readSystemFile.execute({}, {}, { file_path: 'core/conversationStore.js' })
    expect(resCore).toContain('[SYSTEM: File Content for "core/conversationStore.js"')
    expect(resCore).toContain('conversationStore')

    const resFrontend = await readSystemFile.execute({}, {}, { file_path: 'frontend/src/types.ts' })
    expect(resFrontend).toContain('[SYSTEM: File Content for "frontend/src/types.ts"')
    expect(resFrontend).toContain('AuthUser')

    const resServer = await readSystemFile.execute({}, {}, { file_path: 'server/server.js' })
    expect(resServer).toContain('[SYSTEM: File Content for "server/server.js"')

    const resBot = await readSystemFile.execute({}, {}, { file_path: 'bot.js' })
    expect(resBot).toContain('[SYSTEM: File Content for "bot.js"')

    const resDoc = await readSystemFile.execute({}, {}, { file_path: 'AGENTS.md' })
    expect(resDoc).toContain('[SYSTEM: File Content for "AGENTS.md"')
  })

  test('strictly rejects path traversal attempts', async () => {
    const res = await readSystemFile.execute({}, {}, { file_path: '../../etc/passwd' })
    expect(res).toContain('Access Denied. Path traversal')
  })

  test('strictly rejects non-whitelisted paths and node_modules', async () => {
    const res = await readSystemFile.execute({}, {}, { file_path: 'node_modules/express/index.js' })
    expect(res).toContain('not in the allowed file whitelist')
  })
})
