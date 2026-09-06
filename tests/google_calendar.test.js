const axios = require('axios')
const googleCalendar = require('../util/actions/google_calendar')
const actionExecutor = require('../util/ActionExecutor')

jest.mock('axios')
jest.mock('../logger')

describe('google_calendar action', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OWNER_ID = 'owner_123'
    process.env.GOOGLE_CALENDAR_DEFAULT = 'Anime Releases'
    jest.spyOn(googleCalendar, 'getAccessToken').mockResolvedValue('mock-token')
  })

  test('has ownerOnly: true flag set', () => {
    expect(googleCalendar.ownerOnly).toBe(true)
    expect(googleCalendar.name).toBe('google_calendar')
  })

  test('resolves calendar by exact name match', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        items: [
          { id: 'primary_id', summary: 'Personal' },
          { id: 'anime_cal_id', summary: 'Anime Releases', accessRole: 'writer' }
        ]
      }
    })

    const calendar = await googleCalendar.resolveCalendar('Anime Releases')
    expect(calendar.id).toBe('anime_cal_id')
    expect(calendar.summary).toBe('Anime Releases')
  })

  test('resolves calendar by partial name match', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        items: [
          { id: 'anime_cal_id', summary: 'My Anime Releases 2026' }
        ]
      }
    })

    const calendar = await googleCalendar.resolveCalendar('Anime')
    expect(calendar.id).toBe('anime_cal_id')
  })

  test('resolves calendar when requested plural but summary is singular', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        items: [
          { id: 'anime_cal_id', summary: 'Anime Release' }
        ]
      }
    })

    const calendar = await googleCalendar.resolveCalendar('Anime Releases')
    expect(calendar.id).toBe('anime_cal_id')
    expect(calendar.summary).toBe('Anime Release')
  })

  test('resolves calendar by direct ID directly', async () => {
    const directId = 'd3e7be3fc1d4d1e92789ac4a2283caafbf36f322d0244e4b87a5bee9c15b2566@group.calendar.google.com'
    axios.get.mockResolvedValueOnce({
      data: {
        items: [
          { id: directId, summary: 'Anime Release' }
        ]
      }
    })

    const calendar = await googleCalendar.resolveCalendar(directId)
    expect(calendar.id).toBe(directId)
  })

  test('throws informative error if no calendars are shared with the service account', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        items: []
      }
    })

    await expect(googleCalendar.resolveCalendar('Anime Releases')).rejects.toThrow(/No calendars are currently shared/)
  })

  test('creates an event on the resolved calendar', async () => {
    // 1. Calendar list response
    axios.get.mockResolvedValueOnce({
      data: {
        items: [{ id: 'anime_123', summary: 'Anime Releases' }]
      }
    })

    // 2. Event insert response
    axios.post.mockResolvedValueOnce({
      data: {
        id: 'evt_999',
        summary: 'Solo Leveling Ep 5',
        htmlLink: 'https://calendar.google.com/event/evt_999'
      }
    })

    const result = await googleCalendar.execute(
      {},
      {},
      {
        operation: 'create_event',
        summary: 'Solo Leveling Ep 5',
        start: '2026-09-10T15:00:00Z',
        duration_minutes: 45,
        description: 'New episode drop'
      },
      { isOwner: true }
    )

    expect(result).toContain('Added to Google Calendar (Anime Releases)')
    expect(result).toContain('Solo Leveling Ep 5')
    expect(axios.post).toHaveBeenCalledTimes(1)
    expect(axios.post.mock.calls[0][0]).toContain('anime_123')
    expect(axios.post.mock.calls[0][1].summary).toBe('Solo Leveling Ep 5')
  })

  test('creates an anime release event with Crunchyroll color and seasonal recurrence', async () => {
    axios.get.mockResolvedValueOnce({
      data: { items: [{ id: 'anime_123', summary: 'Anime Releases' }] }
    })
    axios.post.mockResolvedValueOnce({
      data: {
        id: 'evt_cr_1',
        summary: 'Frieren S2',
        colorId: '6',
        recurrence: ['RRULE:FREQ=WEEKLY;COUNT=12']
      }
    })

    const result = await googleCalendar.execute(
      {},
      {},
      {
        operation: 'create_event',
        summary: 'Frieren S2',
        start: '2026-10-02T16:30:00Z',
        streaming_service: 'Crunchyroll',
        seasonal_run: true,
        simulcast: 'Fridays at 11:30 AM CST',
        link: 'https://www.crunchyroll.com/series/GG5H5XQX4'
      },
      { isOwner: true }
    )

    expect(result).toContain('Added to Google Calendar (Anime Releases)')
    expect(result).toContain('**Platform Color ID:** `6`')
    expect(result).toContain('**Recurrence:** `RRULE:FREQ=WEEKLY;COUNT=12`')
    const postedBody = axios.post.mock.calls[0][1]
    expect(postedBody.colorId).toBe('6')
    expect(postedBody.recurrence).toEqual(['RRULE:FREQ=WEEKLY;COUNT=12'])
    expect(postedBody.description).toContain('Streaming Service: Crunchyroll')
    expect(postedBody.description).toContain('Simulcast: Fridays at 11:30 AM CST')
    expect(postedBody.extendedProperties.private.source).toBe('skynet')
  })

  test('correctly maps various streaming service colors', () => {
    expect(googleCalendar.resolveColorId('crunchyroll')).toBe('6')
    expect(googleCalendar.resolveColorId('netflix')).toBe('11')
    expect(googleCalendar.resolveColorId('hidive')).toBe('9')
    expect(googleCalendar.resolveColorId('hulu')).toBe('10')
    expect(googleCalendar.resolveColorId('disney+')).toBe('7')
    expect(googleCalendar.resolveColorId('prime video')).toBe('1')
  })

  test('builds seasonal and continuing recurrence properly', () => {
    expect(googleCalendar.buildRecurrence({ seasonal_run: true })).toEqual(['RRULE:FREQ=WEEKLY;COUNT=12'])
    expect(googleCalendar.buildRecurrence({ episodes_count: 24 })).toEqual(['RRULE:FREQ=WEEKLY;COUNT=24'])
    expect(googleCalendar.buildRecurrence({ continuing: true })).toEqual(['RRULE:FREQ=WEEKLY'])
    expect(googleCalendar.buildRecurrence({ until: '2026-12-25T23:59:59Z', start: '2026-07-03T16:00:00Z' })).toEqual(['RRULE:FREQ=WEEKLY;UNTIL=20261225T235959Z;BYDAY=FR'])
  })

  test('updates an existing event by query', async () => {
    axios.get
      // 1. Resolve calendar
      .mockResolvedValueOnce({
        data: { items: [{ id: 'anime_123', summary: 'Anime Releases' }] }
      })
      // 2. Query search
      .mockResolvedValueOnce({
        data: { items: [{ id: 'evt_find_1', summary: 'Chainsaw Man' }] }
      })

    axios.patch.mockResolvedValueOnce({
      data: {
        id: 'evt_find_1',
        summary: 'Chainsaw Man - Reze Arc',
        colorId: '6',
        recurrence: ['RRULE:FREQ=WEEKLY']
      }
    })

    const result = await googleCalendar.execute(
      {},
      {},
      {
        operation: 'update_event',
        query: 'Chainsaw Man',
        summary: 'Chainsaw Man - Reze Arc',
        streaming_service: 'crunchyroll',
        continuing: true
      },
      { isOwner: true }
    )

    expect(result).toContain('Updated Google Calendar Event')
    expect(result).toContain('Chainsaw Man - Reze Arc')
    expect(axios.patch).toHaveBeenCalledTimes(1)
    const patchBody = axios.patch.mock.calls[0][1]
    expect(patchBody.colorId).toBe('6')
    expect(patchBody.recurrence).toEqual(['RRULE:FREQ=WEEKLY'])
  })

  test('lists upcoming events on the target calendar', async () => {
    axios.get
      // 1. Calendar list
      .mockResolvedValueOnce({
        data: { items: [{ id: 'anime_123', summary: 'Anime Releases' }] }
      })
      // 2. Events list
      .mockResolvedValueOnce({
        data: {
          items: [
            { id: 'e1', summary: 'Chainsaw Man S2 Drop', start: { dateTime: '2026-09-12T18:00:00Z' } }
          ]
        }
      })

    const result = await googleCalendar.execute(
      {},
      {},
      {
        operation: 'list_events',
        calendar: 'Anime Releases'
      },
      { isOwner: true }
    )

    expect(result).toContain('UPCOMING EVENTS ON "Anime Releases"')
    expect(result).toContain('Chainsaw Man S2 Drop')
  })

  test('deletes an event by direct event_id', async () => {
    axios.get.mockResolvedValueOnce({
      data: { items: [{ id: 'anime_123', summary: 'Anime Releases' }] }
    })
    axios.delete.mockResolvedValueOnce({ data: {} })

    const result = await googleCalendar.execute(
      {},
      {},
      {
        operation: 'delete_event',
        event_id: 'evt_del_123'
      },
      { isOwner: true }
    )

    expect(result).toContain('Event Deleted from Google Calendar')
    expect(axios.delete).toHaveBeenCalledTimes(1)
    expect(axios.delete.mock.calls[0][0]).toContain('evt_del_123')
  })

  test('rejects execution by non-owner via ActionExecutor', async () => {
    const result = await actionExecutor.executeAction(
      'google_calendar',
      { operation: 'list_calendars' },
      { userId: 'not_the_owner', isOwner: false }
    )

    expect(result.error).toContain('Access Denied')
    expect(result.success).toBe(false)
  })

  test('does not send DM for event creation when in an interactive session', async () => {
    const notifySpy = jest.spyOn(googleCalendar, 'notifyOwnerDm').mockResolvedValue()
    axios.get.mockResolvedValueOnce({
      data: { items: [{ id: 'anime_123', summary: 'Anime Releases' }] }
    })
    axios.post.mockResolvedValueOnce({
      data: { id: 'evt_interactive_1', summary: 'Interactive Anime' }
    })

    await googleCalendar.execute(
      {},
      {},
      { operation: 'create_event', summary: 'Interactive Anime', start: '2026-09-10T10:00:00Z' },
      { isOwner: true, isInteractive: true, interaction: {} }
    )

    expect(notifySpy).not.toHaveBeenCalled()
    notifySpy.mockRestore()
  })

  test('sends DM for event creation when executed as a scheduled task', async () => {
    const notifySpy = jest.spyOn(googleCalendar, 'notifyOwnerDm').mockResolvedValue()
    axios.get.mockResolvedValueOnce({
      data: { items: [{ id: 'anime_123', summary: 'Anime Releases' }] }
    })
    axios.post.mockResolvedValueOnce({
      data: { id: 'evt_scheduled_1', summary: 'Scheduled Anime' }
    })

    await googleCalendar.execute(
      {},
      {},
      { operation: 'create_event', summary: 'Scheduled Anime', start: '2026-09-10T10:00:00Z' },
      { isOwner: true, isScheduled: true, isInteractive: false }
    )

    expect(notifySpy).toHaveBeenCalledTimes(1)
    expect(notifySpy.mock.calls[0][0]).toContain('Scheduled Anime')
    notifySpy.mockRestore()
  })
})
