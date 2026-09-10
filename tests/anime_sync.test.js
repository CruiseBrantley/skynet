const axios = require('axios')
const animeSync = require('../util/actions/anime_sync')
const googleCalendar = require('../util/actions/google_calendar')
const actionExecutor = require('../util/ActionExecutor')

jest.mock('axios')
jest.mock('../logger')

describe('anime_sync action', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
    axios.get = jest.fn().mockResolvedValue({ data: {} })
    axios.post = jest.fn().mockResolvedValue({ data: {} })
    animeSync.clearAnimeDetailsCache?.()
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

  describe('Edge Cases & Hardening', () => {
    describe('extractSeasonNumber', () => {
      test('correctly extracts Arabic season, part, and cour numbers', () => {
        expect(animeSync.extractSeasonNumber('Jujutsu Kaisen Season 2')).toBe(2)
        expect(animeSync.extractSeasonNumber('Fire Force S3')).toBe(3)
        expect(animeSync.extractSeasonNumber('Slime s04')).toBe(4)
        expect(animeSync.extractSeasonNumber('Tensei Kizoku 3rd Season')).toBe(3)
        expect(animeSync.extractSeasonNumber('Kimi no Na wa 1st Season')).toBe(1)
        expect(animeSync.extractSeasonNumber('Bleach Part 2')).toBe(2)
        expect(animeSync.extractSeasonNumber('Spy x Family Cour 2')).toBe(2)
      })

      test('correctly extracts Roman numerals for seasons and sequels', () => {
        expect(animeSync.extractSeasonNumber('DanMachi Season IV')).toBe(4)
        expect(animeSync.extractSeasonNumber('Overlord IV')).toBe(4)
        expect(animeSync.extractSeasonNumber('Mob Psycho 100 III')).toBe(3)
        expect(animeSync.extractSeasonNumber('Date A Live V')).toBe(5)
        expect(animeSync.extractSeasonNumber('Kingdom Season II')).toBe(2)
      })

      test('returns null for titles without season markers', () => {
        expect(animeSync.extractSeasonNumber('One Piece')).toBeNull()
        expect(animeSync.extractSeasonNumber('Tokyo Revengers')).toBeNull()
        expect(animeSync.extractSeasonNumber('The Villager of Level 999')).toBeNull()
        expect(animeSync.extractSeasonNumber('10 Year-Long Last Stand')).toBeNull()
        expect(animeSync.extractSeasonNumber(null)).toBeNull()
        expect(animeSync.extractSeasonNumber('')).toBeNull()
      })
    })

    describe('extractMalIdFromEvent', () => {
      test('extracts MAL ID from extendedProperties private fields', () => {
        expect(animeSync.extractMalIdFromEvent({ extendedProperties: { private: { idMal: '60601' } } })).toBe(60601)
        expect(animeSync.extractMalIdFromEvent({ extendedProperties: { private: { mal_id: '59088' } } })).toBe(59088)
        expect(animeSync.extractMalIdFromEvent({ extendedProperties: { private: { malId: '12345' } } })).toBe(12345)
      })

      test('extracts MAL ID from description URL and text label', () => {
        expect(animeSync.extractMalIdFromEvent({ description: 'MAL: https://myanimelist.net/anime/60601' })).toBe(60601)
        expect(animeSync.extractMalIdFromEvent({ description: 'Notes here\nMAL ID: 59088' })).toBe(59088)
        expect(animeSync.extractMalIdFromEvent({ description: 'Airing on Crunchyroll. MAL: 42249' })).toBe(42249)
      })

      test('returns null when event has no MAL ID information', () => {
        expect(animeSync.extractMalIdFromEvent({ summary: 'No ID Event' })).toBeNull()
        expect(animeSync.extractMalIdFromEvent(null)).toBeNull()
        expect(animeSync.extractMalIdFromEvent({})).toBeNull()
      })
    })

    describe('isTitleOnCalendar edge cases', () => {
      const calendar = [
        'That Time I Got Reincarnated as a Slime Season 4',
        'Bleach Part 1',
        'As a Reincarnated Aristocrat, I\'ll Use My Appraisal Skill to Rise in the World Season 3',
        'One Piece'
      ]

      test('prevents season mismatch from false matching', () => {
        expect(animeSync.isTitleOnCalendar('That Time I Got Reincarnated as a Slime Season 3', calendar)).toBe(false)
        expect(animeSync.isTitleOnCalendar('That Time I Got Reincarnated as a Slime Season 2', calendar)).toBe(false)
        expect(animeSync.isTitleOnCalendar('That Time I Got Reincarnated as a Slime Season 4', calendar)).toBe(true)
      })

      test('prevents part/cour mismatch from false matching', () => {
        expect(animeSync.isTitleOnCalendar('Bleach Part 2', calendar)).toBe(false)
        expect(animeSync.isTitleOnCalendar('Bleach Part 1', calendar)).toBe(true)
      })

      test('never false-matches substring words like Kill la Kill to Appraisal Skill', () => {
        expect(animeSync.isTitleOnCalendar('Kill la Kill', calendar)).toBe(false)
      })

      test('handles smart quotes, apostrophes, and punctuation gracefully', () => {
        expect(animeSync.isTitleOnCalendar('As a Reincarnated Aristocrat, I’ll Use My Appraisal Skill to Rise in the World Season 3', calendar)).toBe(true)
      })

      test('handles parenthetical tags such as English Dub and platform tags', () => {
        expect(animeSync.isTitleOnCalendar('One Piece (English Dub)', calendar)).toBe(true)
        expect(animeSync.isTitleOnCalendar('One Piece (Crunchyroll)', calendar)).toBe(true)
      })

      test('returns false for null, undefined, or empty calendar', () => {
        expect(animeSync.isTitleOnCalendar(null, calendar)).toBe(false)
        expect(animeSync.isTitleOnCalendar('One Piece', null)).toBe(false)
        expect(animeSync.isTitleOnCalendar('One Piece', [])).toBe(false)
      })
    })

    describe('resolveAnimeSchedule edge cases', () => {
      test('prioritizes English titles from media, MAL alternative titles, or item', async () => {
        const schedule = await animeSync.resolveAnimeSchedule({
          title: 'Tensei Kizoku 3rd Season',
          animeId: 60601,
          media: {
            idMal: 60601,
            title: {
              romaji: 'Tensei Kizoku 3rd Season',
              english: 'As a Reincarnated Aristocrat Season 3'
            },
            status: 'RELEASING',
            episodes: 12
          }
        })
        expect(schedule.canonicalTitle).toBe('As a Reincarnated Aristocrat Season 3')
      })

      test('defers upcoming anime premiering in future seasons (> 7 days away) to pending', async () => {
        const futureDate = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000)
        const schedule = await animeSync.resolveAnimeSchedule({
          title: 'Tokyo Revengers: War of the Three Titan Arc',
          animeId: 59088,
          media: {
            idMal: 59088,
            title: { english: 'Tokyo Revengers: War of the Three Titan Arc' },
            status: 'NOT_YET_RELEASED',
            nextAiringEpisode: {
              airingAt: Math.floor(futureDate.getTime() / 1000),
              episode: 1
            },
            startDate: { year: futureDate.getUTCFullYear(), month: futureDate.getUTCMonth() + 1, day: futureDate.getUTCDate() }
          }
        })
        expect(schedule.isUpcoming).toBe(true)
        expect(schedule.pendingSchedule).toBe(true)
      })

      test('schedules upcoming anime premiering within the next 7 days', async () => {
        const imminentDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
        const schedule = await animeSync.resolveAnimeSchedule({
          title: 'Imminent Premiere Anime',
          animeId: 99999,
          media: {
            idMal: 99999,
            title: { english: 'Imminent Premiere Anime' },
            status: 'NOT_YET_RELEASED',
            nextAiringEpisode: {
              airingAt: Math.floor(imminentDate.getTime() / 1000),
              episode: 1
            }
          }
        })
        expect(schedule.isUpcoming).toBe(true)
        expect(schedule.pendingSchedule).toBe(false)
        expect(schedule.hasBroadcastSchedule).toBe(true)
      })

      test('handles continuous long-running series with indefinite episode count', async () => {
        const schedule = await animeSync.resolveAnimeSchedule({
          title: 'One Piece',
          animeId: 21,
          media: {
            idMal: 21,
            title: { english: 'One Piece' },
            status: 'RELEASING',
            episodes: null,
            nextAiringEpisode: { episode: 1120, airingAt: Math.floor(Date.now() / 1000) + 86400 }
          }
        })
        expect(schedule.isContinuing).toBe(true)
        expect(schedule.calculatedEndDate).toBeNull()
        expect(schedule.recurrenceLabel).toBe('Continuing Weekly')
      })
    })

    describe('scheduleAnimeOnCalendar edge cases', () => {
      test('rejects event creation when title is missing or whitespace', async () => {
        const res = await animeSync.scheduleAnimeOnCalendar({
          calendarTarget: 'Anime Release',
          schedule: { canonicalTitle: '   ' }
        })
        expect(res.success).toBe(false)
        expect(res.error).toContain('valid non-empty title')
      })

      test('returns immediately for pending schedule without modifying calendar', async () => {
        const res = await animeSync.scheduleAnimeOnCalendar({
          calendarTarget: 'Anime Release',
          schedule: {
            canonicalTitle: 'Black Clover Season 2',
            pendingSchedule: true,
            timeDesc: 'Oct 2026'
          }
        })
        expect(res.success).toBe(true)
        expect(res.pendingSchedule).toBe(true)
      })

      test('deduplicates and updates existing event by MAL ID', async () => {
        jest.spyOn(googleCalendar, 'resolveCalendar').mockResolvedValue({ id: 'cal_id', summary: 'Anime Release' })
        const calExecuteSpy = jest.spyOn(googleCalendar, 'execute').mockResolvedValueOnce('Updated')

        const existingEvent = {
          id: 'existing_evt_1',
          summary: 'Tensei Kizoku 3rd Season',
          extendedProperties: { private: { idMal: '60601' } }
        }

        const schedule = {
          canonicalTitle: 'As a Reincarnated Aristocrat Season 3',
          animeId: 60601,
          startDate: new Date('2026-09-27T15:00:00Z'),
          platform: 'crunchyroll',
          episodesCount: 12,
          simulcastStr: 'Sundays at 10 AM CST',
          calculatedEndDate: new Date('2026-12-13T23:59:59Z')
        }

        const res = await animeSync.scheduleAnimeOnCalendar({
          calendarTarget: 'cal_id',
          schedule,
          existingEvents: [existingEvent],
          context: { isOwner: true }
        })

        expect(res.success).toBe(true)
        expect(calExecuteSpy).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({
            operation: 'update_event',
            event_id: 'existing_evt_1',
            summary: 'As a Reincarnated Aristocrat Season 3'
          }),
          expect.any(Object)
        )
      })
    })

    describe('Jikan API fallback and broadcast scheduling', () => {
      test('getAnimeDetails falls back to Jikan when AniList returns 403', async () => {
        // AniList fails with 403
        axios.post.mockRejectedValueOnce({
          response: {
            status: 403,
            data: { errors: [{ message: 'AniList API temporarily disabled' }] }
          }
        })
        // Jikan succeeds
        axios.get.mockResolvedValueOnce({
          data: {
            data: {
              mal_id: 61469,
              title: 'Steel Ball Run: JoJo no Kimyou na Bouken',
              title_english: 'Steel Ball Run: JoJo\'s Bizarre Adventure',
              status: 'Currently Airing',
              episodes: 24,
              streaming: [
                { name: 'Netflix', url: 'https://www.netflix.com/' }
              ],
              broadcast: { day: null, time: null }
            }
          }
        })

        const media = await animeSync.getAnimeDetails('Steel Ball Run', 61469)
        expect(media).not.toBeNull()
        expect(media.idMal).toBe(61469)
        expect(media.title.english).toBe('Steel Ball Run: JoJo\'s Bizarre Adventure')
        expect(media.status).toBe('RELEASING')
        expect(media.externalLinks).toEqual([
          { site: 'Netflix', url: 'https://www.netflix.com/', language: null }
        ])
      })

      test('getStreamingPlatformInfo returns unknown / Streaming TBD when no streaming link matches', () => {
        const noLinkMedia = { externalLinks: [] }
        const info = animeSync.getStreamingPlatformInfo(noLinkMedia)
        expect(info.key).toBe('unknown')
        expect(info.name).toBe('Streaming TBD')
        expect(info.colorId).toBeNull()

        const nullMediaInfo = animeSync.getStreamingPlatformInfo(null)
        expect(nullMediaInfo.key).toBe('unknown')
        expect(nullMediaInfo.name).toBe('Streaming TBD')
        expect(nullMediaInfo.colorId).toBeNull()
      })

      test('getNextBroadcastDate computes upcoming occurrence from JST day and time', () => {
        // Sundays at 23:15 JST
        const nextAir = animeSync.getNextBroadcastDate('Sundays', '23:15', 'Asia/Tokyo')
        expect(nextAir).toBeInstanceOf(Date)
        // 23:15 JST - 9 hours = 14:15 UTC
        expect(nextAir.getUTCHours()).toBe(14)
        expect(nextAir.getUTCMinutes()).toBe(15)
        expect(nextAir.getUTCDay()).toBe(0) // Sunday
      })

      test('resolveAnimeSchedule marks series in hiatus or with unconfirmed broadcast as pendingSchedule', async () => {
        // Steel Ball Run: currently airing on MAL, but no nextAiringEpisode and broadcast day is null
        const sbrMedia = {
          idMal: 61469,
          title: { english: 'Steel Ball Run: JoJo\'s Bizarre Adventure' },
          status: 'RELEASING',
          episodes: 24,
          externalLinks: [{ site: 'Netflix', url: 'https://netflix.com' }],
          broadcast: { day: null, time: null },
          nextAiringEpisode: null,
          startDate: { year: 2026, month: 3, day: 19 } // Part 1 was in March (past)
        }

        const schedule = await animeSync.resolveAnimeSchedule({
          title: 'Steel Ball Run',
          animeId: 61469,
          media: sbrMedia,
          item: { anime_airing_status: 1 } // Watching on MAL
        })

        expect(schedule.platform).toBe('netflix')
        expect(schedule.hasBroadcastSchedule).toBe(false)
        expect(schedule.pendingSchedule).toBe(true)
        expect(schedule.timeDesc).toBe('Broadcast schedule unconfirmed')
        expect(schedule.startDate).toBeNull()
      })

      test('resolveAnimeSchedule schedules anime with confirmed broadcast from Jikan', async () => {
        const opMedia = {
          idMal: 21,
          title: { english: 'One Piece' },
          status: 'RELEASING',
          episodes: null,
          externalLinks: [{ site: 'Crunchyroll', url: 'https://crunchyroll.com/one-piece' }],
          broadcast: { day: 'Sundays', time: '23:15', timezone: 'Asia/Tokyo' }
        }

        const schedule = await animeSync.resolveAnimeSchedule({
          title: 'One Piece',
          animeId: 21,
          media: opMedia,
          item: { anime_airing_status: 1 }
        })

        expect(schedule.platform).toBe('crunchyroll')
        expect(schedule.hasBroadcastSchedule).toBe(true)
        expect(schedule.pendingSchedule).toBe(false)
        expect(schedule.startDate).toBeInstanceOf(Date)
        expect(schedule.simulcastStr).toContain('Sunday')
      })
    })
  })
})

