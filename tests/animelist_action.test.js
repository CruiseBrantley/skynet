const animelistAction = require('../util/actions/animelist')
const malClient = require('../util/malClient')
const googleCalendar = require('../util/actions/google_calendar')

jest.mock('../util/malClient')
jest.mock('../util/actions/google_calendar')
jest.mock('../util/actions/anime_sync', () => {
  const actual = jest.requireActual('../util/actions/anime_sync')
  return {
    ...actual,
    getAnimeDetails: jest.fn().mockImplementation(async (title) => ({
      title: { english: title },
      episodes: 28
    })),
    getStreamingPlatformInfo: jest.fn().mockReturnValue({ name: 'Crunchyroll', site: 'Crunchyroll', key: 'crunchyroll', emoji: '🟠' })
  }
})
jest.mock('../logger')

describe('Built-in Action - animelist permissions', () => {
  const OWNER_ID = '199749017150816256'
  const ALLOWED_CHANNEL = '1062784669034229780'

  beforeAll(() => {
    process.env.OWNER_ID = OWNER_ID
    process.env.ANIME_CHANNEL_ID = ALLOWED_CHANNEL
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('operation "add" is rejected for non-owner in unauthorized channel', async () => {
    const mockChannel = { id: 'other_channel_999' }
    const context = { userId: 'non_owner_user', isOwner: false }

    const result = await animelistAction.execute(null, mockChannel, {
      operation: 'add',
      title: 'Solo Leveling'
    }, context)

    expect(result).toContain('Permission denied')
    expect(result).toContain(ALLOWED_CHANNEL)
    expect(malClient.addAnime).not.toHaveBeenCalled()
  })

  test('operation "add" is allowed for non-owner in authorized channel 1062784669034229780', async () => {
    const mockChannel = { id: ALLOWED_CHANNEL }
    const context = { userId: 'non_owner_user', isOwner: false }
    malClient.addAnime.mockResolvedValueOnce({
      title: 'Solo Leveling',
      animeId: 56789
    })
    malClient.getPublicUrl.mockReturnValue('https://myanimelist.net/animelist/skynetanimelist')

    const result = await animelistAction.execute(null, mockChannel, {
      operation: 'add',
      title: 'Solo Leveling',
      sync_calendar: false
    }, context)

    expect(result).toContain('Added "Solo Leveling"')
    expect(malClient.addAnime).toHaveBeenCalledWith('Solo Leveling', { status: 'watching' })
  })

  test('operation "add" is allowed for owner in any channel', async () => {
    const mockChannel = { id: 'some_random_channel' }
    const context = { userId: OWNER_ID, isOwner: true }
    malClient.addAnime.mockResolvedValueOnce({
      title: 'Solo Leveling',
      animeId: 56789
    })
    malClient.getPublicUrl.mockReturnValue('https://myanimelist.net/animelist/skynetanimelist')

    const result = await animelistAction.execute(null, mockChannel, {
      operation: 'add',
      title: 'Solo Leveling',
      sync_calendar: false
    }, context)

    expect(result).toContain('Added "Solo Leveling"')
    expect(malClient.addAnime).toHaveBeenCalledWith('Solo Leveling', { status: 'watching' })
  })

  test('operation "list" is allowed for non-owner in any channel', async () => {
    const mockChannel = { id: 'some_random_channel' }
    const context = { userId: 'non_owner_user', isOwner: false }
    malClient.getUserList.mockResolvedValueOnce([
      { anime_id: 1, anime_title: 'Frieren', anime_num_episodes: 28, episodes_watched: 10, airing_status: 'currently_airing' }
    ])

    const result = await animelistAction.execute(null, mockChannel, {
      operation: 'list'
    }, context)

    expect(result).toContain('Frieren')
    expect(result).not.toContain('Permission denied')
  })

  test('action is rejected for non-owner in another server', async () => {
    const mockChannel = { id: ALLOWED_CHANNEL, guildId: 'other_guild_9999' }
    const context = { userId: 'non_owner_user', isOwner: false }

    const result = await animelistAction.execute(null, mockChannel, {
      operation: 'list'
    }, context)

    expect(result).toContain('Permission denied')
    expect(result).toContain('525112230006489091')
  })

  test('operation "add" defers calendar scheduling for upcoming anime without confirmed broadcast date', async () => {
    const mockChannel = { id: ALLOWED_CHANNEL }
    const context = { userId: OWNER_ID, isOwner: true }
    malClient.addAnime.mockResolvedValueOnce({
      title: 'Black Clover 2nd Season',
      animeId: 61967
    })
    malClient.searchAnime.mockResolvedValueOnce({
      id: 61967,
      title: 'Black Clover 2nd Season',
      status: 'not_yet_aired',
      media: {
        status: 'NOT_YET_RELEASED',
        startDate: { year: 2026, month: 10, day: null },
        nextAiringEpisode: null
      }
    })
    malClient.getPublicUrl.mockReturnValue('https://myanimelist.net/animelist/skynetanimelist')

    const result = await animelistAction.execute(null, mockChannel, {
      operation: 'add',
      title: 'Black Clover 2nd Season',
      sync_calendar: true
    }, context)

    expect(result).toContain('Premiere date not yet confirmed (Oct 2026)')
    expect(googleCalendar.execute).not.toHaveBeenCalled()
  })
})
