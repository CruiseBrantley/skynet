const axios = require('axios')
const animeSync = require('../util/actions/anime_sync')
const googleCalendar = require('../util/actions/google_calendar')
const actionExecutor = require('../util/ActionExecutor')

jest.mock('axios')
jest.mock('../logger')

describe('anime_sync action', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OWNER_ID = 'owner_123'
    process.env.MYANIMELIST_USERNAME = 'skynetanimelist'
    process.env.GOOGLE_CALENDAR_DEFAULT = 'Anime Release'
  })

  test('has ownerOnly: true flag set', () => {
    expect(animeSync.ownerOnly).toBe(true)
    expect(animeSync.name).toBe('anime_sync')
  })

  test('isDubEntry identifies dub releases and preserves subtitled versions', () => {
    expect(animeSync.isDubEntry('Black Torch (Dub)')).toBe(true)
    expect(animeSync.isDubEntry('Chainsaw Man English Dub')).toBe(true)
    expect(animeSync.isDubEntry('Chainsaw Man', 'English Dub')).toBe(true)
    expect(animeSync.isDubEntry('Black Torch')).toBe(false)
    expect(animeSync.isDubEntry('Frieren', 'Japanese')).toBe(false)
  })

  test('getStreamingPlatformInfo detects various streaming services with respective colors', () => {
    const crMedia = { externalLinks: [{ site: 'Crunchyroll', url: 'https://crunchyroll.com/series/1' }] }
    expect(animeSync.getStreamingPlatformInfo(crMedia).key).toBe('crunchyroll')
    expect(animeSync.getStreamingPlatformInfo(crMedia).colorId).toBe('6')

    const hidiveMedia = { externalLinks: [{ site: 'HIDIVE', url: 'https://hidive.com/1' }] }
    expect(animeSync.getStreamingPlatformInfo(hidiveMedia).key).toBe('hidive')
    expect(animeSync.getStreamingPlatformInfo(hidiveMedia).colorId).toBe('9')

    const disneyMedia = { externalLinks: [{ site: 'Disney Plus', url: 'https://disneyplus.com/1' }] }
    expect(animeSync.getStreamingPlatformInfo(disneyMedia).key).toBe('disney+')
    expect(animeSync.getStreamingPlatformInfo(disneyMedia).colorId).toBe('7')

    const netflixMedia = { externalLinks: [{ site: 'Netflix', url: 'https://netflix.com/1' }] }
    expect(animeSync.getStreamingPlatformInfo(netflixMedia).key).toBe('netflix')
    expect(animeSync.getStreamingPlatformInfo(netflixMedia).colorId).toBe('11')
  })

  test('formatCstSchedule formats unix timestamp into Central Time string', () => {
    // 2026-10-02 16:30:00 UTC = 11:30 AM CDT (Friday)
    const timestamp = 1790958600
    const schedule = animeSync.formatCstSchedule(timestamp)
    expect(schedule.day).toBe('Friday')
    expect(schedule.simulcastString).toContain('Fridays at')
    expect(schedule.simulcastString).toContain('CST')
  })

  test('sync_watchlist fetches MAL and adds anime to Google Calendar', async () => {
    // 1. Mock MAL load.json
    jest.spyOn(animeSync, 'fetchMalList').mockResolvedValueOnce([
      {
        anime_title: 'Frieren S2',
        anime_airing_status: 1,
        status: 1
      }
    ])

    // 2. Mock AniList
    jest.spyOn(animeSync, 'getAnimeDetails').mockResolvedValueOnce({
      id: 999,
      title: { english: 'Frieren: Beyond Journey’s End Season 2' },
      status: 'RELEASING',
      episodes: 12,
      nextAiringEpisode: {
        airingAt: 1790958600,
        episode: 1
      },
      externalLinks: [
        { site: 'Crunchyroll', url: 'https://crunchyroll.com/frieren', language: 'Japanese' }
      ]
    })

    // 3. Mock googleCalendar
    jest.spyOn(googleCalendar, 'getAccessToken').mockResolvedValue('token')
    jest.spyOn(googleCalendar, 'resolveCalendar').mockResolvedValue({ id: 'cal_id', summary: 'Anime Release' })
    axios.get.mockResolvedValueOnce({
      data: {
        items: [{ summary: 'Other Show' }]
      }
    })
    const calExecuteSpy = jest.spyOn(googleCalendar, 'execute')
      .mockResolvedValueOnce('✅ Added to Google Calendar')

    const result = await animeSync.execute({}, {}, {
      operation: 'sync_watchlist',
      username: 'skynetanimelist'
    }, { isOwner: true })

    expect(result).toContain('**Added to Calendar:** **Frieren: Beyond Journey’s End Season 2**')
    expect(calExecuteSpy).toHaveBeenCalledTimes(1)
    const createCallArgs = calExecuteSpy.mock.calls[0][2]
    expect(createCallArgs.operation).toBe('create_event')
    expect(createCallArgs.streaming_service).toBe('crunchyroll')
    expect(createCallArgs.seasonal_run).toBe(true)
    expect(createCallArgs.simulcast).toContain('Fridays at')
  })

  test('isTitleOnCalendar matches core anime titles across seasons and formats', () => {
    const calendarTitles = [
      'Hell\'s Paradise',
      'JUJUTSU KAISEN',
      'Fire Force S3',
      'One Piece'
    ]

    expect(animeSync.isTitleOnCalendar('Hell’s Paradise Season 2', calendarTitles)).toBe(true)
    expect(animeSync.isTitleOnCalendar('JUJUTSU KAISEN Season 3: The Culling Game Part 1', calendarTitles)).toBe(true)
    expect(animeSync.isTitleOnCalendar('Fire Force Season 3 Part 2', calendarTitles)).toBe(true)
    expect(animeSync.isTitleOnCalendar('DAN DA DAN', calendarTitles)).toBe(false)
    expect(animeSync.isTitleOnCalendar('Clevatess Season 2', calendarTitles)).toBe(false)
  })

  test('check_ended_series audits calendar and identifies completed seasonal runs', async () => {
    jest.spyOn(googleCalendar, 'getAccessToken').mockResolvedValue('token')
    jest.spyOn(googleCalendar, 'resolveCalendar').mockResolvedValue({ id: 'anime_cal_id', summary: 'Anime Release' })

    // Mock calendar events fetch
    axios.get.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'evt_finished',
            summary: 'Solo Leveling Season 1',
            recurrence: ['RRULE:FREQ=WEEKLY;COUNT=12'],
            extendedProperties: { private: { source: 'skynet' } }
          },
          {
            id: 'evt_active',
            summary: 'One Piece',
            recurrence: ['RRULE:FREQ=WEEKLY'],
            extendedProperties: { private: { source: 'skynet' } }
          }
        ]
      }
    })

    jest.spyOn(animeSync, 'getAnimeDetails')
      .mockImplementation(async (title) => {
        if (title.includes('Solo Leveling')) {
          return {
            status: 'FINISHED',
            episodes: 12,
            nextAiringEpisode: null
          }
        }
        if (title.includes('One Piece')) {
          return {
            status: 'RELEASING',
            episodes: null,
            nextAiringEpisode: { episode: 1120 }
          }
        }
        return null
      })

    // Audit mode (confirm_delete: false)
    const auditResult = await animeSync.execute({}, {}, {
      operation: 'check_ended_series'
    }, { isOwner: true })

    expect(auditResult).toContain('Anime Seasonal Run Audit')
    expect(auditResult).toContain('**Ready to Clear Future Events:** **Solo Leveling Season 1**')
    expect(auditResult).toContain('Still Airing / Scheduled:')
    expect(auditResult).toContain('One Piece')
    expect(axios.delete).not.toHaveBeenCalled()

    // Delete mode (confirm_delete: true)
    axios.get.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'evt_finished',
            summary: 'Solo Leveling Season 1',
            recurrence: ['RRULE:FREQ=WEEKLY;COUNT=12']
          }
        ]
      }
    })
    axios.patch = jest.fn().mockResolvedValueOnce({ data: {} })
    // Return empty future instances
    axios.get.mockResolvedValueOnce({ data: { items: [] } })

    const deleteResult = await animeSync.execute({}, {}, {
      operation: 'check_ended_series',
      confirm_delete: true
    }, { isOwner: true })

    expect(deleteResult).toContain('**Future Events Cleared:** **Solo Leveling Season 1**')
    expect(axios.patch).toHaveBeenCalledTimes(1)
    const patchArgs = axios.patch.mock.calls[0][1]
    expect(patchArgs.recurrence[0]).toContain('UNTIL=')
  })

  test('truncateFutureOccurrences modifies RRULE with UNTIL and cleans future instances', async () => {
    const mockEvent = {
      id: 'event_rezero',
      summary: 'Re:ZERO -Starting Life in Another World- Season 3',
      start: { dateTime: '2024-10-02T14:30:00Z' },
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=24']
    }
    const mockMedia = {
      status: 'FINISHED',
      endDate: { year: 2024, month: 11, day: 20 },
      nextAiringEpisode: null
    }

    axios.patch = jest.fn().mockResolvedValueOnce({ data: {} })
    axios.get = jest.fn().mockResolvedValueOnce({
      data: {
        items: [{ id: 'inst_future_1' }, { id: 'inst_future_2' }]
      }
    })
    axios.delete = jest.fn().mockResolvedValue({ data: {} })

    const res = await animeSync.truncateFutureOccurrences('cal_id', mockEvent, mockMedia, 'token')

    expect(res.action).toBe('truncated_future_recurrence')
    expect(axios.patch).toHaveBeenCalledWith(
      expect.stringContaining('event_rezero'),
      expect.objectContaining({
        recurrence: [expect.stringMatching(/RRULE:FREQ=WEEKLY;UNTIL=\d{8}T\d{6}Z/)]
      }),
      expect.any(Object)
    )
    expect(axios.delete).toHaveBeenCalledTimes(2)
  })

  test('detectAndApplyScheduleDrift detects day shift and updates calendar', async () => {
    const mockEvent = {
      id: 'event_bleach',
      summary: 'Bleach',
      start: { date: '2026-07-25' }, // Saturday
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=SA']
    }
    // Sunday 2026-09-13 14:00:00 UTC = 1789308000
    const mockMedia = {
      idMal: 60636,
      episodes: 10,
      nextAiringEpisode: {
        episode: 8,
        airingAt: 1789308000 // Sunday
      }
    }

    axios.patch = jest.fn().mockResolvedValueOnce({ data: {} })
    axios.get = jest.fn().mockResolvedValueOnce({ data: { items: [] } })
    axios.post = jest.fn().mockResolvedValueOnce({ data: { id: 'new_event_bleach' } })

    const res = await animeSync.detectAndApplyScheduleDrift('cal_id', mockEvent, mockMedia, 'token', false)

    expect(res.updated).toBe(true)
    expect(res.message).toContain('Broadcast day updated from Saturday to Sunday')
    expect(axios.patch).toHaveBeenCalledWith(
      expect.stringContaining('event_bleach'),
      expect.objectContaining({
        recurrence: [expect.stringMatching(/RRULE:FREQ=WEEKLY.*UNTIL=/)]
      }),
      expect.any(Object)
    )
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('cal_id'),
      expect.objectContaining({
        summary: 'Bleach',
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=SU;COUNT=3']
      }),
      expect.any(Object)
    )
  })

  test('detectAndApplyScheduleDrift returns updated: false when day matches', async () => {
    const mockEvent = {
      id: 'event_bleach',
      summary: 'Bleach',
      start: { date: '2026-07-25' }, // Saturday
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=SA']
    }
    // Saturday 2026-09-12 14:00:00 UTC = 1789221600
    const mockMedia = {
      idMal: 60636,
      episodes: 10,
      nextAiringEpisode: {
        episode: 8,
        airingAt: 1789221600 // Saturday
      }
    }

    const res = await animeSync.detectAndApplyScheduleDrift('cal_id', mockEvent, mockMedia, 'token', false)
    expect(res.updated).toBe(false)
  })

  test('calculateSeriesEndDate calculates exact UTC finale dates', () => {
    // 1. Explicit endDate
    const d1 = animeSync.calculateSeriesEndDate({
      endDate: { year: 2026, month: 12, day: 25 },
      episodes: 26
    })
    expect(d1.toISOString()).toBe('2026-12-25T23:59:59.000Z')

    // 2. Next airing episode + remaining episodes
    const d2 = animeSync.calculateSeriesEndDate({
      episodes: 10,
      nextAiringEpisode: {
        episode: 8,
        airingAt: Math.floor(new Date('2026-09-12T14:30:00Z').getTime() / 1000)
      }
    })
    expect(d2.toISOString()).toBe('2026-09-26T23:59:59.000Z')

    // 3. Upcoming series from start date
    const d3 = animeSync.calculateSeriesEndDate({
      episodes: 12
    }, new Date('2026-10-02T16:30:00Z'))
    expect(d3.toISOString()).toBe('2026-12-18T23:59:59.000Z')

    // 4. Infinite series returns null
    const d4 = animeSync.calculateSeriesEndDate({ episodes: null })
    expect(d4).toBeNull()

    // 5. Seasonal anime with unknown total episodes (episodes: null), using 12-ep seasonal default
    const d5 = animeSync.calculateSeriesEndDate({
      episodes: null,
      nextAiringEpisode: {
        episode: 11,
        airingAt: Math.floor(new Date('2026-09-12T14:00:00Z').getTime() / 1000)
      }
    }, new Date('2026-07-04'), 12)
    expect(d5.toISOString()).toBe('2026-09-19T23:59:59.000Z')
  })

  test('rejects execution by non-owner via ActionExecutor', async () => {
    const result = await actionExecutor.executeAction(
      'anime_sync',
      { operation: 'sync_watchlist' },
      { userId: 'intruder', isOwner: false }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Access Denied')
  })

  test('sync_watchlist defers calendar creation for upcoming anime with unconfirmed broadcast dates', async () => {
    jest.spyOn(animeSync, 'fetchMalList').mockResolvedValueOnce([
      {
        anime_title: 'Black Clover 2nd Season',
        anime_airing_status: 3,
        anime_season: { year: 2026, season: 'fall' }
      }
    ])

    jest.spyOn(animeSync, 'getAnimeDetails').mockResolvedValueOnce({
      id: 195604,
      title: { english: 'Black Clover Season 2' },
      status: 'NOT_YET_RELEASED',
      startDate: { year: 2026, month: 10, day: null },
      nextAiringEpisode: null,
      externalLinks: [
        { site: 'Crunchyroll', url: 'https://crunchyroll.com/black-clover' }
      ]
    })

    jest.spyOn(googleCalendar, 'getAccessToken').mockResolvedValue('token')
    jest.spyOn(googleCalendar, 'resolveCalendar').mockResolvedValue({ id: 'cal_id', summary: 'Anime Release' })
    axios.get.mockResolvedValueOnce({
      data: { items: [] }
    })
    const calExecuteSpy = jest.spyOn(googleCalendar, 'execute')

    const result = await animeSync.execute({}, {}, {
      operation: 'sync_watchlist',
      username: 'skynetanimelist',
      structured: true
    }, { isOwner: true })

    expect(calExecuteSpy).not.toHaveBeenCalled()
    expect(result.pendingBroadcast).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Black Clover Season 2',
        timeDesc: 'Oct 2026'
      })
    ]))
    expect(result.summaryText).toContain('Premiere date unconfirmed (Oct 2026) — pending broadcast schedule.')
  })
})
