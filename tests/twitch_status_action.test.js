const axios = require('axios')
const getTwitchStatusAction = require('../util/actions/get_twitch_status')
const getOAuthToken = require('../server/oauth')

jest.mock('axios')
jest.mock('../server/oauth')

describe('get_twitch_status Action', () => {
  const originalEnv = process.env

  beforeAll(() => {
    process.env = { ...originalEnv, TWITCH_CLIENTID: 'mock-client-id' }
    getOAuthToken.mockResolvedValue('mock-oauth-token')
  })

  afterAll(() => {
    process.env = originalEnv
  })

  test('returns live details when target streamer is streaming', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        data: [
          {
            user_name: 'Fireraven',
            user_login: 'fireraven',
            game_name: 'Diablo IV',
            title: 'Pushing Pit 150!',
            viewer_count: 342,
            started_at: '2026-08-24T02:00:00Z'
          }
        ]
      }
    })

    const res = await getTwitchStatusAction.execute({}, {}, { username: 'fireraven' })
    expect(res).toContain('LIVE')
    expect(res).toContain('Fireraven')
    expect(res).toContain('Diablo IV')
    expect(res).toContain('342')
  })

  test('returns offline when target streamer is not live', async () => {
    axios.get.mockResolvedValueOnce({
      data: { data: [] }
    })

    const res = await getTwitchStatusAction.execute({}, {}, { username: 'offline_user' })
    expect(res).toContain('Offline')
    expect(res).toContain('offline_user')
  })
})
