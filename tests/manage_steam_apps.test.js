const fs = require('fs')
const path = require('path')
const manageSteamApps = require('../util/actions/manage_steam_apps')

describe('manage_steam_apps Action', () => {
  const CONFIG_PATH = path.join(__dirname, '../config/steam_apps.json')
  let originalConfig = ''

  beforeAll(() => {
    if (fs.existsSync(CONFIG_PATH)) {
      originalConfig = fs.readFileSync(CONFIG_PATH, 'utf8')
    }
  })

  afterAll(() => {
    if (originalConfig) {
      fs.writeFileSync(CONFIG_PATH, originalConfig, 'utf8')
    }
  })

  test('reads existing server configurations', async () => {
    const res = await manageSteamApps.execute({}, {}, { action: 'read' })
    expect(res).toContain('Loaded')
    expect(res).toContain('icarus')
  })

  test('adds a new server configuration with backup', async () => {
    const res = await manageSteamApps.execute({}, {}, {
      action: 'add',
      data: {
        name: 'Test Server',
        key: 'test_game',
        appId: '999999',
        installDir: 'C:\\test',
        processName: 'test.exe',
        executable: 'start.bat',
        queryPort: 27015
      }
    })

    expect(res).toContain('Successfully added')
    expect(res).toContain('test_game')

    // Read back
    const readBack = await manageSteamApps.execute({}, {}, { action: 'read', key: 'test_game' })
    expect(readBack).toContain('Test Server')
    expect(readBack).toContain('999999')
  })

  test('updates an existing server configuration', async () => {
    const updateRes = await manageSteamApps.execute({}, {}, {
      action: 'update',
      key: 'test_game',
      data: {
        queryPort: 27099
      }
    })

    expect(updateRes).toContain('Successfully updated')
    expect(updateRes).toContain('27099')
  })

  test('removes the server configuration', async () => {
    const removeRes = await manageSteamApps.execute({}, {}, {
      action: 'remove',
      key: 'test_game'
    })

    expect(removeRes).toContain('Successfully removed')
  })
})
