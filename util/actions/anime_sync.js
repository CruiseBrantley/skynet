const axios = require('axios')
const logger = require('../../logger')
const googleCalendar = require('./google_calendar')

const ANILIST_API = 'https://graphql.anilist.co'
const animeDetailsCache = new Map()

/**
 * Query AniList GraphQL for anime airing schedule, status, and streaming links.
 */
async function getAnimeDetails (title, idMal = null) {
  if (!title && !idMal) return null
  const cacheKey = idMal ? `idmal:${idMal}` : title.toLowerCase().trim()
  if (animeDetailsCache.has(cacheKey)) {
    return animeDetailsCache.get(cacheKey)
  }

  const query = `
    query ($search: String, $idMal: Int) {
      Media (search: $search, idMal: $idMal, type: ANIME) {
        id
        idMal
        title {
          romaji
          english
          native
        }
        status
        episodes
        format
        nextAiringEpisode {
          airingAt
          timeUntilAiring
          episode
        }
        startDate {
          year
          month
          day
        }
        endDate {
          year
          month
          day
        }
        externalLinks {
          site
          url
          language
        }
      }
    }
  `
  const variables = idMal ? { idMal: parseInt(idMal, 10) } : { search: title }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await axios.post(
        ANILIST_API,
        { query, variables },
        { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 10000 }
      )
      const media = res.data?.data?.Media || null
      animeDetailsCache.set(cacheKey, media)
      if (title) animeDetailsCache.set(title.toLowerCase().trim(), media)
      return media
    } catch (err) {
      if (err.response?.status === 429 && attempt < 2) {
        const retryAfter = parseInt(err.response.headers?.['retry-after'], 10) || 5
        logger.warn(`anime_sync: AniList rate limited (429). Waiting ${retryAfter + 1}s before retrying (attempt ${attempt + 1})...`)
        await new Promise(resolve => setTimeout(resolve, (retryAfter + 1) * 1000))
        continue
      }
      logger.warn(`anime_sync: AniList query failed for "${title || idMal}": ${err.message}`)
      return null
    }
  }
  return null
}

/**
 * Fetch MyAnimeList user animelist.
 * Supports status 1 (Watching), 6 (Plan to Watch), 7 (All).
 */
async function fetchMalList (username, status = 1) {
  const cleanUser = (username || process.env.MYANIMELIST_USERNAME || 'skynetanimelist').trim()
  const url = `https://myanimelist.net/animelist/${encodeURIComponent(cleanUser)}/load.json?status=${status}`

  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      timeout: 10000
    })
    return Array.isArray(res.data) ? res.data : []
  } catch (err) {
    if (err.response?.status === 400 || err.response?.status === 403) {
      throw new Error(`MyAnimeList for "${cleanUser}" returned HTTP ${err.response.status}. Your list may be set to Private. Please open MyAnimeList > Settings > Privacy > Anime List and set to "Public".`)
    }
    throw new Error(`Failed to fetch MyAnimeList for "${cleanUser}": ${err.message}`)
  }
}

/**
 * Convert Unix timestamp to Central Time (America/Chicago) string and day of week.
 */
function formatCstSchedule (unixTimestamp) {
  if (!unixTimestamp) return null
  const date = new Date(unixTimestamp * 1000)
  const dayOptions = { timeZone: 'America/Chicago', weekday: 'long' }
  const timeOptions = { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hour12: true }

  const day = new Intl.DateTimeFormat('en-US', dayOptions).format(date)
  const time = new Intl.DateTimeFormat('en-US', timeOptions).format(date)
  return {
    date,
    day,
    time,
    simulcastString: `${day}s at ${time} CST`
  }
}

const SUPPORTED_STREAMING_PLATFORMS = [
  { name: 'Crunchyroll', key: 'crunchyroll', pattern: /crunchyroll/i, emoji: '🟠', colorId: '6' },
  { name: 'HIDIVE', key: 'hidive', pattern: /hidive/i, emoji: '🔵', colorId: '9' },
  { name: 'Netflix', key: 'netflix', pattern: /netflix/i, emoji: '🔴', colorId: '11' },
  { name: 'Disney+', key: 'disney+', pattern: /disney/i, emoji: '🩵', colorId: '7' },
  { name: 'Hulu', key: 'hulu', pattern: /hulu/i, emoji: '🟢', colorId: '10' },
  { name: 'Prime Video', key: 'prime video', pattern: /prime|amazon/i, emoji: '🔷', colorId: '1' }
]

/**
 * Check if title or language tag indicates a dub release.
 */
function isDubEntry (title, language) {
  if (title && /\b(dub|dubbed|english dub|en dub|spanish dub|latin dub)\b/i.test(title)) return true
  if (language && /\bdub\b/i.test(language) && !/japanese/i.test(language)) return true
  return false
}

/**
 * Detect streaming service across all platforms, strictly prioritizing Japanese subtitled releases.
 */
function getStreamingPlatformInfo (media) {
  if (!media || !Array.isArray(media.externalLinks)) {
    return { name: 'Crunchyroll', site: 'Crunchyroll', key: 'crunchyroll', emoji: '🟠', url: null, colorId: '6' }
  }

  for (const platform of SUPPORTED_STREAMING_PLATFORMS) {
    const link = media.externalLinks.find(l => l.site && platform.pattern.test(l.site))
    if (link) {
      if (link.language && isDubEntry('', link.language)) continue
      return {
        name: platform.name,
        site: platform.name,
        key: platform.key,
        emoji: platform.emoji,
        url: link.url,
        colorId: platform.colorId
      }
    }
  }

  return { name: 'Crunchyroll', site: 'Crunchyroll', key: 'crunchyroll', emoji: '🟠', url: null, colorId: '6' }
}

// Alias for backwards-compatibility
function getCrunchyrollInfo (media) {
  const p = getStreamingPlatformInfo(media)
  return p.key === 'crunchyroll' ? p : null
}

/**
 * Extract season or part number from a title string.
 */
function extractSeasonNumber (str) {
  if (!str) return null
  const romanMap = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 }

  const digitMatch = str.match(/(?:season|cour|part)\s*(\d+)|\bs(\d+)\b|(\d+)(?:nd|rd|th|st)\s*season/i)
  if (digitMatch) {
    return parseInt(digitMatch[1] || digitMatch[2] || digitMatch[3], 10)
  }

  const romanMatch = str.match(/\b(?:season|cour|part)\s*([ivx]+)\b/i)
  if (romanMatch) {
    const val = romanMap[romanMatch[1].toLowerCase()]
    if (val) return val
  }

  // Check standalone trailing roman numeral after title (e.g. "Overlord IV", "DanMachi III")
  const trailingRoman = str.match(/\s+([ivx]+)$/i)
  if (trailingRoman) {
    const val = romanMap[trailingRoman[1].toLowerCase()]
    if (val && val > 1) return val
  }

  return null
}

/**
 * Extract MAL ID from calendar event properties or description.
 */
function extractMalIdFromEvent (event) {
  if (!event) return null
  const idFromPrivate = event.extendedProperties?.private?.idMal ||
    event.extendedProperties?.private?.mal_id ||
    event.extendedProperties?.private?.malId
  if (idFromPrivate && !isNaN(parseInt(idFromPrivate, 10))) {
    return parseInt(idFromPrivate, 10)
  }
  if (event.description) {
    const urlMatch = event.description.match(/myanimelist\.net\/anime\/(\d+)/i)
    if (urlMatch) return parseInt(urlMatch[1], 10)
    const labelMatch = event.description.match(/MAL(?:\s*ID)?:\s*(\d+)/i)
    if (labelMatch) return parseInt(labelMatch[1], 10)
  }
  return null
}

/**
 * Robust title matching against existing calendar titles to prevent duplicate additions.
 * Uses exact normalized matching, season number consistency, and whole-word token matching.
 */
function isTitleOnCalendar (title, calendarTitles) {
  if (!title || !Array.isArray(calendarTitles) || calendarTitles.length === 0) return false

  const titleSeason = extractSeasonNumber(title)
  const cleanTitle = title.toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/season\s*\d+|cour\s*\d+|part\s*\d+|s\d+|(\d+)(?:nd|rd|th|st)\s*season/gi, '')
    .replace(/[^a-z0-9]/g, ' ')
    .trim()
  const titleWords = new Set(cleanTitle.split(/\s+/).filter(w => w.length > 2))

  return calendarTitles.some(ct => {
    if (!ct) return false
    const ctSeason = extractSeasonNumber(ct)
    if (titleSeason !== null && ctSeason !== null && titleSeason !== ctSeason) {
      return false
    }

    const cleanCt = ct.toLowerCase()
      .replace(/\([^)]*\)/g, '')
      .replace(/season\s*\d+|cour\s*\d+|part\s*\d+|s\d+|(\d+)(?:nd|rd|th|st)\s*season/gi, '')
      .replace(/[^a-z0-9]/g, ' ')
      .trim()

    if (cleanTitle === cleanCt) return true
    if (cleanTitle.length >= 6 && cleanCt.startsWith(cleanTitle)) return true
    if (cleanCt.length >= 6 && cleanTitle.startsWith(cleanCt)) return true

    const ctWords = new Set(cleanCt.split(/\s+/).filter(w => w.length > 2))
    if (titleWords.size === 0 || ctWords.size === 0) return false

    let matchCount = 0
    for (const w of titleWords) {
      if (ctWords.has(w)) matchCount++
    }

    const minWords = Math.min(titleWords.size, ctWords.size)
    const ratio = matchCount / minWords
    if (minWords >= 3 && ratio >= 0.7) return true
    if (minWords === 2 && matchCount === 2 && (cleanTitle.startsWith(cleanCt) || cleanCt.startsWith(cleanTitle))) return true

    return false
  })
}

/**
 * Single source of truth for resolving anime metadata, titles, schedule, and recurrence.
 */
async function resolveAnimeSchedule (params = {}) {
  const {
    title,
    animeId,
    media: providedMedia,
    animeInfo: providedAnimeInfo,
    item: providedItem,
    platformOverride,
    episodesOverride
  } = params

  let media = providedMedia
  const animeInfo = providedAnimeInfo

  if (!media && !animeInfo) {
    if (animeId || title) {
      media = await getAnimeDetails(title, animeId)
    }
  }

  const effectiveId = animeId || animeInfo?.id || media?.idMal || providedItem?.anime_id

  // If AniList did not have an English title, try fetching MAL search/details for the official English title
  let malEnglish = providedItem?.anime_title_eng || animeInfo?.alternative_titles?.en || animeInfo?.title
  if (!media?.title?.english && !malEnglish && effectiveId) {
    try {
      const malClient = require('../malClient')
      if (typeof malClient.searchAnime === 'function') {
        const searched = await malClient.searchAnime(title || String(effectiveId))
        if (searched?.title) {
          malEnglish = searched.title
        }
      }
    } catch (_) {}
  }

  const canonicalTitle = media?.title?.english || malEnglish || media?.title?.romaji || providedItem?.anime_title || title || 'Unknown Anime'
  const romajiTitle = media?.title?.romaji || providedItem?.anime_title || title
  const platformInfo = getStreamingPlatformInfo(media)
  const platform = platformOverride || platformInfo?.key || platformInfo?.name || platformInfo?.site || 'crunchyroll'
  const episodesCount = episodesOverride
    ? parseInt(episodesOverride, 10)
    : (media?.episodes || animeInfo?.episodes || null)

  const isUpcoming = media?.status === 'NOT_YET_RELEASED' ||
    animeInfo?.status === 'not_yet_aired' ||
    animeInfo?.status === 3 ||
    providedItem?.anime_airing_status === 3

  // For upcoming series:
  // An upcoming series is ready to be scheduled on Google Calendar only when it is premiering
  // within the current weekly cycle (<= 7 days) and has an exact confirmed broadcast timestamp.
  // Upcoming anime releasing in future months/seasons (e.g. October 2026) are deferred
  // to pending broadcast status so they don't clutter current calendars with unconfirmed dates.
  const isAiringWithinWeek = Boolean(
    media?.nextAiringEpisode?.airingAt &&
    (media.nextAiringEpisode.airingAt * 1000 - Date.now() <= 7 * 24 * 60 * 60 * 1000)
  )

  const hasBroadcastSchedule = Boolean(
    (!isUpcoming && (media?.nextAiringEpisode?.airingAt || media?.status === 'RELEASING' || providedItem?.anime_airing_status === 1)) ||
    (isUpcoming && isAiringWithinWeek)
  )

  const year = media?.startDate?.year || animeInfo?.start_season?.year || providedItem?.anime_season?.year
  const month = media?.startDate?.month
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthStr = month ? monthNames[month - 1] : (animeInfo?.start_season?.season ? animeInfo.start_season.season.toUpperCase() : null)
  const timeDesc = monthStr && year ? `${monthStr} ${year}` : (year ? String(year) : 'Date TBD')

  let startDate = null
  let simulcastStr = 'Weekly Simulcast'

  if (media?.nextAiringEpisode?.airingAt) {
    const cst = formatCstSchedule(media.nextAiringEpisode.airingAt)
    if (cst) {
      startDate = cst.date
      simulcastStr = cst.simulcastString
    }
  } else if (media?.startDate?.year && media?.startDate?.month && media?.startDate?.day) {
    startDate = new Date(Date.UTC(media.startDate.year, media.startDate.month - 1, media.startDate.day, 14, 0, 0))
  } else {
    startDate = new Date()
  }

  const calculatedEndDate = calculateSeriesEndDate(media, startDate, episodesCount)
  const isContinuing = !calculatedEndDate && !media?.episodes && !animeInfo?.episodes
  const recurrenceLabel = calculatedEndDate
    ? `Until ${calculatedEndDate.toISOString().split('T')[0]} (${episodesCount || 12} eps)`
    : (isContinuing ? 'Continuing Weekly' : `${episodesCount || 12} episodes`)

  return {
    animeId: effectiveId,
    canonicalTitle,
    romajiTitle,
    englishTitle: media?.title?.english || malEnglish,
    coverImage: media?.coverImage?.large || animeInfo?.coverImage,
    platformInfo,
    platform,
    episodesCount,
    isUpcoming,
    hasBroadcastSchedule,
    pendingSchedule: isUpcoming && !hasBroadcastSchedule,
    timeDesc,
    startDate,
    simulcastStr,
    calculatedEndDate,
    isContinuing,
    recurrenceLabel,
    link: platformInfo?.url || '',
    media
  }
}

/**
 * Schedule or update an anime on Google Calendar.
 * Handles duplicate detection (by MAL ID and by Title), deferred scheduling for unannounced air dates,
 * and standard event parameters.
 */
async function scheduleAnimeOnCalendar (params = {}) {
  const {
    calendarTarget = process.env.GOOGLE_CALENDAR_DEFAULT || 'Anime Release',
    schedule,
    existingEvents = [],
    context = {},
    bot = null,
    channel = null
  } = params

  if (!schedule || !schedule.canonicalTitle || !schedule.canonicalTitle.trim()) {
    return {
      success: false,
      error: 'Cannot schedule anime without a valid non-empty title.'
    }
  }

  if (schedule.pendingSchedule) {
    return {
      success: true,
      pendingSchedule: true,
      timeDesc: schedule.timeDesc,
      platform: schedule.platform,
      canonicalTitle: schedule.canonicalTitle
    }
  }

  let targetCalId = calendarTarget
  try {
    const targetCal = await googleCalendar.resolveCalendar(calendarTarget)
    if (targetCal?.id) targetCalId = targetCal.id
  } catch (_) {}

  // Check existing events on calendar to avoid duplicate entries
  // 1. By exact MAL ID
  let existingEvent = null
  if (schedule.animeId && existingEvents.length > 0) {
    existingEvent = existingEvents.find(e => {
      const eMalId = extractMalIdFromEvent(e)
      return eMalId && String(eMalId) === String(schedule.animeId)
    })
  }

  // 2. By Title if not matched by ID
  if (!existingEvent && existingEvents.length > 0) {
    existingEvent = existingEvents.find(e => {
      return isTitleOnCalendar(schedule.canonicalTitle, [e.summary]) ||
        (schedule.romajiTitle && isTitleOnCalendar(schedule.romajiTitle, [e.summary]))
    })
  }

  // 3. Fallback to API findExistingEvent if existingEvents list wasn't provided
  if (!existingEvent && existingEvents.length === 0) {
    try {
      existingEvent = await googleCalendar.findExistingEvent(targetCalId, schedule.canonicalTitle, schedule.animeId)
    } catch (_) {}
  }

  const calParams = {
    operation: existingEvent ? 'update_event' : 'create_event',
    calendar: targetCalId,
    summary: schedule.canonicalTitle,
    streaming_service: schedule.platform,
    seasonal_run: !schedule.isContinuing,
    continuing: schedule.isContinuing,
    episodes_count: schedule.episodesCount,
    simulcast: schedule.simulcastStr,
    start: schedule.startDate.toISOString(),
    link: schedule.link,
    mal_id: schedule.animeId,
    idMal: schedule.animeId
  }

  if (existingEvent) {
    calParams.event_id = existingEvent.id
  }
  if (schedule.calculatedEndDate) {
    calParams.until = schedule.calculatedEndDate.toISOString()
  }

  let calResult
  let isFailed = false
  try {
    const ActionExecutor = require('../ActionExecutor')
    const actionRes = await ActionExecutor.executeAction('google_calendar', calParams, { ...context, isInteractive: true })
    if (actionRes.success) {
      calResult = actionRes.output || 'Success'
    } else {
      isFailed = true
      calResult = actionRes.error || 'Calendar operation failed'
    }
  } catch (_) {
    calResult = await googleCalendar.execute(bot, channel, calParams, { ...context, isInteractive: true })
    isFailed = !calResult || (typeof calResult === 'string' && calResult.includes('FAILED'))
  }

  return {
    success: !isFailed,
    isUpdated: Boolean(existingEvent),
    eventId: existingEvent?.id,
    platform: schedule.platform,
    simulcast: schedule.simulcastStr,
    recurrence: schedule.recurrenceLabel,
    canonicalTitle: schedule.canonicalTitle,
    calResult,
    error: isFailed ? calResult : null
  }
}

/**
 * Truncate or remove future occurrences of a finished series on Google Calendar,
 * preserving all past historical events as an airing record.
 *
 * @param {string} calendarId - Google Calendar ID
 * @param {object} event - Google Calendar event object
 * @param {object} media - AniList media object
 * @param {string} token - Google OAuth access token
 * @returns {Promise<{ action: string, until?: string, deletedCount?: number }>}
 */
async function truncateFutureOccurrences (calendarId, event, media, token) {
  const now = new Date()
  const nowIso = now.toISOString()
  const isRecurring = Boolean(event.recurrence && event.recurrence.length > 0)

  // Determine series end date cutoff
  let untilDate = now
  if (media?.endDate?.year && media?.endDate?.month && media?.endDate?.day) {
    const end = new Date(Date.UTC(media.endDate.year, media.endDate.month - 1, media.endDate.day, 23, 59, 59))
    if (!isNaN(end.getTime()) && end <= now) {
      untilDate = end
    }
  }
  const untilStr = untilDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'

  if (isRecurring) {
    const eventStart = new Date(event.start?.dateTime || event.start?.date || 0)
    // If the entire event only starts in the future, deleting the event deletes no past entries
    if (eventStart > now) {
      await axios.delete(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      return { action: 'deleted_future_series' }
    }

    // Otherwise, it has past occurrences that MUST be preserved!
    // Truncate recurrence rule by setting UNTIL to the cutoff date
    const updatedRecurrence = event.recurrence.map(rule => {
      if (rule.startsWith('RRULE:')) {
        const cleanRule = rule
          .replace(/;UNTIL=[^;]+/gi, '')
          .replace(/;COUNT=\d+/gi, '')
        return `${cleanRule};UNTIL=${untilStr}`
      }
      return rule
    })

    await axios.patch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}`,
      { recurrence: updatedRecurrence },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    )

    // Delete any remaining future instances from now onwards
    let deletedCount = 0
    try {
      const instRes = await axios.get(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}/instances?timeMin=${encodeURIComponent(nowIso)}&maxResults=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const futureInstances = instRes.data?.items || []
      for (const inst of futureInstances) {
        try {
          await axios.delete(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(inst.id)}`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          deletedCount++
        } catch (_) {}
      }
    } catch (_) {}

    return { action: 'truncated_future_recurrence', until: untilDate.toISOString(), deletedCount }
  } else {
    // Single (non-recurring) event
    const eventStart = new Date(event.start?.dateTime || event.start?.date || 0)
    if (eventStart >= now) {
      await axios.delete(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      return { action: 'deleted_future_single_event' }
    }
    // Past single event - strictly preserved
    return { action: 'preserved_past_event' }
  }
}

/**
 * Detect if the next airing episode has shifted broadcast day compared to
 * the existing Google Calendar recurrence, and update the schedule accordingly.
 *
 * @param {string} calendarId - Google Calendar ID
 * @param {object} event - Google Calendar event object
 * @param {object} media - AniList media object
 * @param {string} token - Google OAuth access token
 * @param {boolean} dryRun - If true, preview changes without modifying calendar
 * @returns {Promise<{ updated: boolean, message?: string }>}
 */
async function detectAndApplyScheduleDrift (calendarId, event, media, token, dryRun = false) {
  if (!media?.nextAiringEpisode?.airingAt) return { updated: false }
  const isRecurring = Boolean(event.recurrence && event.recurrence.length > 0)
  if (!isRecurring) return { updated: false }

  const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  // 1. Detect existing scheduled day on Google Calendar
  let currentDay = null
  const byDayMatch = event.recurrence[0]?.match(/BYDAY=([A-Z]{2})/i)
  if (byDayMatch) {
    currentDay = byDayMatch[1].toUpperCase()
  } else if (event.start?.dateTime || event.start?.date) {
    currentDay = days[new Date(event.start.dateTime || event.start.date).getUTCDay()]
  }

  if (!currentDay) return { updated: false }

  // 2. Detect target broadcast day from AniList nextAiringEpisode
  const nextAirDate = new Date(media.nextAiringEpisode.airingAt * 1000)
  const targetDay = days[nextAirDate.getUTCDay()]
  const targetDayName = dayNames[nextAirDate.getUTCDay()]
  const currentDayName = dayNames[days.indexOf(currentDay)] || currentDay

  // If broadcast day has not shifted, no schedule drift
  if (currentDay === targetDay) return { updated: false }

  const nextEpNum = media.nextAiringEpisode.episode
  const dateStr = nextAirDate.toISOString().split('T')[0]

  if (dryRun) {
    return {
      updated: true,
      message: `- 🔄 **${event.summary}**: Broadcast day shift detected: ${currentDayName} (${currentDay}) ➡️ ${targetDayName} (${targetDay}) starting Ep ${nextEpNum} on ${dateStr} (DRY RUN)`
    }
  }

  // 3. Truncate previous recurrence rule right before the new episode
  const cutoffDate = new Date(nextAirDate.getTime() - 24 * 60 * 60 * 1000)
  const untilStr = cutoffDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const updatedRecurrence = event.recurrence.map(rule => {
    if (rule.startsWith('RRULE:')) {
      const cleanRule = rule
        .replace(/;UNTIL=[^;]+/gi, '')
        .replace(/;COUNT=\d+/gi, '')
      return `${cleanRule};UNTIL=${untilStr}`
    }
    return rule
  })

  await axios.patch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}`,
    { recurrence: updatedRecurrence },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  )

  // Purge any pre-expanded future instances of the old event
  try {
    const instRes = await axios.get(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}/instances?timeMin=${encodeURIComponent(new Date().toISOString())}&maxResults=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    for (const inst of (instRes.data?.items || [])) {
      try {
        await axios.delete(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(inst.id)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
      } catch (_) {}
    }
  } catch (_) {}

  // 4. Create new recurring event starting on the new broadcast day and time
  const remainingCount = media.episodes ? Math.max(1, media.episodes - nextEpNum + 1) : null
  const newRecurrence = remainingCount
    ? [`RRULE:FREQ=WEEKLY;BYDAY=${targetDay};COUNT=${remainingCount}`]
    : [`RRULE:FREQ=WEEKLY;BYDAY=${targetDay}`]

  const isAllDay = Boolean(event.start?.date && !event.start?.dateTime)
  const startPayload = isAllDay
    ? { date: dateStr }
    : { dateTime: nextAirDate.toISOString(), timeZone: 'UTC' }
  const endPayload = isAllDay
    ? { date: dateStr }
    : { dateTime: new Date(nextAirDate.getTime() + 30 * 60 * 1000).toISOString(), timeZone: 'UTC' }

  const newEventPayload = {
    summary: event.summary,
    description: event.description || `Streaming update via Skynet\nMAL: https://myanimelist.net/anime/${media.idMal || ''}`,
    start: startPayload,
    end: endPayload,
    recurrence: newRecurrence,
    colorId: event.colorId || '6',
    extendedProperties: {
      private: {
        source: 'skynet',
        idMal: String(media.idMal || ''),
        shiftedFrom: currentDay,
        shiftedTo: targetDay
      }
    }
  }

  await axios.post(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    newEventPayload,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  )

  return {
    updated: true,
    message: `- 🔄 **${event.summary}**: Broadcast day updated from ${currentDayName} to ${targetDayName} starting Ep ${nextEpNum} on ${dateStr} (historical episodes preserved)`
  }
}

/**
 * Calculate the season finale date for an anime based on AniList media data.
 * @param {object} media AniList media object
 * @param {Date|string} startDate Scheduled start date or next episode date
 * @param {number} [episodeCountOverride] Optional episode count override (e.g. standard 12-ep seasonal default)
 * @returns {Date|null} Exact UTC finale Date or null if indefinite/unknown
 */
function calculateSeriesEndDate (media, startDate, episodeCountOverride) {
  if (!media && !episodeCountOverride) return null

  // 1. Explicit end date from AniList
  if (media?.endDate && media.endDate.year && media.endDate.month && media.endDate.day) {
    return new Date(Date.UTC(media.endDate.year, media.endDate.month - 1, media.endDate.day, 23, 59, 59))
  }

  // 2. Calculated from episode count
  const totalEpisodes = episodeCountOverride || media?.episodes
  if (totalEpisodes && totalEpisodes > 0) {
    if (media?.nextAiringEpisode?.airingAt && media?.nextAiringEpisode?.episode) {
      const remainingEps = Math.max(0, totalEpisodes - media.nextAiringEpisode.episode)
      const finaleAiringAt = media.nextAiringEpisode.airingAt + (remainingEps * 7 * 86400)
      const airDate = new Date(finaleAiringAt * 1000)
      return new Date(Date.UTC(airDate.getUTCFullYear(), airDate.getUTCMonth(), airDate.getUTCDate(), 23, 59, 59))
    }

    const baseDate = startDate instanceof Date ? startDate : (startDate ? new Date(startDate) : new Date())
    if (!isNaN(baseDate.getTime())) {
      const finaleTime = baseDate.getTime() + (Math.max(0, totalEpisodes - 1) * 7 * 86400 * 1000)
      const airDate = new Date(finaleTime)
      return new Date(Date.UTC(airDate.getUTCFullYear(), airDate.getUTCMonth(), airDate.getUTCDate(), 23, 59, 59))
    }
  }

  return null
}

module.exports = {
  name: 'anime_sync',
  description: 'Sync anime releases from MyAnimeList/Crunchyroll to Google Calendar and audit/cleanup completed seasonal runs.',
  ownerOnly: true,
  schema: {
    operation: 'Operation: "sync_watchlist" or "check_ended_series"',
    username: 'MyAnimeList username (defaults to MYANIMELIST_USERNAME in .env or "skynetanimelist")',
    calendar: 'Target calendar name or ID (defaults to GOOGLE_CALENDAR_DEFAULT or "Anime Release")',
    max_items: 'Maximum items to scan/schedule from watchlist (default: 10)',
    status: 'Watchlist status to sync (1: Watching [default], 6: Plan to Watch, 7: All)',
    dry_run: 'Boolean: preview what would be added without modifying Google Calendar',
    confirm_delete: 'Boolean: for check_ended_series, set to true to actually remove confirmed ended series from calendar'
  },
  execute: async (bot, channel, params, context) => {
    const operation = (params.operation || 'sync_watchlist').toLowerCase()
    const username = (params.username || process.env.MYANIMELIST_USERNAME || 'skynetanimelist').trim()
    const calendarTarget = params.calendar || process.env.GOOGLE_CALENDAR_DEFAULT || 'Anime Release'
    const dryRun = Boolean(params.dry_run)

    // ─────────────────────────────────────────────────────────────
    // Operation: sync_watchlist
    // ─────────────────────────────────────────────────────────────
    if (operation === 'sync_watchlist') {
      const statusFilter = params.status ? parseInt(params.status, 10) : 1
      const malItems = await module.exports.fetchMalList(username, statusFilter)

      if (malItems.length === 0) {
        return `[SYSTEM: MyAnimeList list for "${username}" returned 0 items for status ${statusFilter}.]`
      }

      // Filter strictly for currently airing (anime_airing_status: 1) or upcoming TV series (anime_airing_status: 3)
      // Never add finished series (anime_airing_status: 2) to the calendar
      const airingCandidates = malItems.filter(
        item => item.anime_airing_status === 1 || item.anime_airing_status === 3
      )

      const limit = parseInt(params.max_items, 10) || 100
      const toProcess = airingCandidates.slice(0, limit)

      // Fetch all existing calendar templates to prevent duplicate additions across any season
      const token = await googleCalendar.getAccessToken()
      const calendar = await googleCalendar.resolveCalendar(calendarTarget)
      let existingCalendarTitles = []
      let existingCalendarEvents = []
      let activeCalendarEvents = []
      try {
        let pageToken = null
        do {
          const calRes = await axios.get(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`,
            {
              headers: { Authorization: `Bearer ${token}` },
              params: { maxResults: 250, pageToken }
            }
          )
          const items = calRes.data?.items || []
          existingCalendarEvents = existingCalendarEvents.concat(items)
          pageToken = calRes.data?.nextPageToken
        } while (pageToken)

        const now = new Date()
        activeCalendarEvents = existingCalendarEvents.filter(event => {
          if (!event.summary) return false
          const rrule = (event.recurrence && event.recurrence[0]) || ''
          if (rrule.includes('UNTIL=')) {
            const match = rrule.match(/UNTIL=(\d{4})(\d{2})(\d{2})/i)
            if (match) {
              const untilDate = new Date(Date.UTC(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10), 23, 59, 59))
              if (untilDate < now) return false
            }
          }
          const countMatch = rrule.match(/COUNT=(\d+)/i)
          if (countMatch) {
            const count = parseInt(countMatch[1], 10)
            const start = new Date(event.start?.dateTime || event.start?.date || 0)
            const endDate = new Date(start.getTime() + count * 7 * 24 * 60 * 60 * 1000)
            if (endDate < now) return false
          }
          if (!rrule) {
            const end = new Date(event.end?.dateTime || event.end?.date || event.start?.dateTime || event.start?.date || 0)
            if (end.getTime() > 0 && end < new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)) return false
          }
          return true
        })
        existingCalendarTitles = activeCalendarEvents.map(e => e.summary).filter(Boolean)
      } catch (err) {
        logger.warn(`anime_sync: Failed to fetch full calendar events list: ${err.message}`)
      }

      const results = []
      const canModifyCalendar = !calendar.accessRole || calendar.accessRole === 'writer' || calendar.accessRole === 'owner'
      if (!canModifyCalendar && !dryRun) {
        results.push('⚠️ **Google Calendar Permission Notice:**')
        results.push(`Skynet service account (\`skynet-calendar@skynet-293804.iam.gserviceaccount.com\`) has \`reader\` access on calendar **${calendar.summary || calendar.id}**.`)
        results.push('To allow automatic scheduling and schedule drift updates, please grant **"Make changes to events"** (`writer`) permission in Google Calendar settings.\n')
      }

      // 1. Audit existing calendar events: truncate future occurrences for series that have finished their run
      // and detect broadcast schedule shifts.
      // Optimize: Only inspect active recurring series that haven't already ended in the past,
      // and only those matching anime titles/metadata to avoid unnecessary AniList rate-limit overhead.
      const endedTruncated = []
      const scheduleShifted = []
      const now = new Date()

      const eventsToAudit = existingCalendarEvents.filter(event => {
        if (!event.summary) return false
        const isRecurring = Boolean(event.recurrence && event.recurrence.length > 0)
        if (!isRecurring) return false

        const rrule = event.recurrence[0] || ''
        if (rrule.includes('UNTIL=')) {
          const match = rrule.match(/UNTIL=(\d{4})(\d{2})(\d{2})/i)
          if (match) {
            const untilDate = new Date(Date.UTC(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10), 23, 59, 59))
            if (untilDate < now) return false
          }
        }

        const countMatch = rrule.match(/COUNT=(\d+)/i)
        if (countMatch) {
          const count = parseInt(countMatch[1], 10)
          const start = new Date(event.start?.dateTime || event.start?.date || 0)
          const endDate = new Date(start.getTime() + count * 7 * 24 * 60 * 60 * 1000)
          if (endDate < now) return false
        }

        const isSkynet = event.extendedProperties?.private?.source === 'skynet'
        const hasAnimeDesc = event.description && /crunchyroll|simulcast|anilist|hidive|funimation|subtitled|myanimelist/i.test(event.description)
        const isWatchlist = malItems.some(item => isTitleOnCalendar(item.anime_title, [event.summary]))

        return isSkynet || hasAnimeDesc || isWatchlist
      })

      for (const event of eventsToAudit) {
        await new Promise(resolve => setTimeout(resolve, 150))
        const eventMalId = extractMalIdFromEvent(event)
        const malMatch = eventMalId
          ? malItems.find(item => item.anime_id === eventMalId)
          : malItems.find(item => isTitleOnCalendar(item.anime_title, [event.summary]))
        const idMal = malMatch ? malMatch.anime_id : eventMalId
        try {
          const media = await module.exports.getAnimeDetails(event.summary, idMal)
          if (media && media.status === 'FINISHED' && !media.nextAiringEpisode) {
            if (!dryRun && canModifyCalendar) {
              const truncRes = await module.exports.truncateFutureOccurrences(calendar.id, event, media, token)
              if (truncRes.action !== 'preserved_past_event') {
                endedTruncated.push(event.summary)
                try {
                  const malClient = require('../malClient')
                  if (malClient.isAuthenticated()) {
                    await malClient.addAnime(media.idMal || event.summary, { status: 'completed' })
                  }
                } catch (_) {}
              }
            } else {
              endedTruncated.push(event.summary)
            }
          } else if (media && media.nextAiringEpisode?.airingAt) {
            const driftRes = await module.exports.detectAndApplyScheduleDrift(calendar.id, event, media, token, dryRun || !canModifyCalendar)
            if (driftRes?.updated && driftRes.message) {
              scheduleShifted.push(driftRes.message)
            }
          }
        } catch (truncErr) {
          logger.warn(`anime_sync: Could not check/truncate future events for "${event.summary}": ${truncErr.message}`)
        }
      }

      if (endedTruncated.length > 0) {
        results.push('🛑 **Ended Series Future Events Cleared (Past Airings Preserved):**')
        endedTruncated.forEach(t => results.push(`- 🛑 **${t}**: Finished airing (future occurrences removed)`))
        results.push('')
      }

      if (scheduleShifted.length > 0) {
        results.push('🔄 **Broadcast Schedule Shifts Detected & Updated:**')
        scheduleShifted.forEach(m => results.push(m))
        results.push('')
      }

      const addedToCalendar = []
      const alreadyPresent = []
      const pendingBroadcast = []
      const syncErrors = []

      for (const item of toProcess) {
        const title = item.anime_title
        await new Promise(resolve => setTimeout(resolve, 150))
        const media = await module.exports.getAnimeDetails(title, item.anime_id)

        if (!media) {
          results.push(`- ⚠️ **${title}**: Could not verify details on AniList.`)
          continue
        }

        const schedule = await resolveAnimeSchedule({
          title,
          animeId: item.anime_id,
          media,
          item
        })

        // 1. Strictly filter out dubs (never add dub releases as separate/duplicate series)
        if (isDubEntry(title) || isDubEntry(schedule.canonicalTitle)) {
          results.push(`- 🚫 **${schedule.canonicalTitle}**: Dub release skipped (subtitles only).`)
          continue
        }

        // 2. Strictly filter out finished series (do not add completed series to calendar)
        if (media.status === 'FINISHED') {
          results.push(`- ⏭️ **${schedule.canonicalTitle}**: Finished airing (not scheduled on calendar).`)
          continue
        }

        // 3. Check if already on calendar (by MAL ID or title)
        const isPresentById = activeCalendarEvents.some(e => {
          const eMalId = extractMalIdFromEvent(e)
          return eMalId && (eMalId === item.anime_id || (media.idMal && eMalId === media.idMal))
        })
        const isPresentByTitle =
          isTitleOnCalendar(schedule.canonicalTitle, existingCalendarTitles) ||
          isTitleOnCalendar(title, existingCalendarTitles) ||
          (item.anime_title_eng && isTitleOnCalendar(item.anime_title_eng, existingCalendarTitles))

        if (isPresentById || isPresentByTitle) {
          alreadyPresent.push({
            title: schedule.canonicalTitle,
            rawTitle: title,
            malId: media.idMal || item.anime_id,
            isUpcoming: item.anime_airing_status === 3
          })
          results.push(`- ⏭️ **${schedule.canonicalTitle}**: Already present on calendar.`)
          continue
        }

        // 4. If upcoming and broadcast schedule is not yet confirmed, defer calendar creation
        if (schedule.pendingSchedule) {
          pendingBroadcast.push({
            title: schedule.canonicalTitle,
            timeDesc: schedule.timeDesc,
            platform: schedule.platform
          })
          results.push(`- ⏳ **${schedule.canonicalTitle}**: Premiere date unconfirmed (${schedule.timeDesc}) — pending broadcast schedule.`)
          continue
        }

        if (dryRun) {
          results.push(`- 📝 **[DRY-RUN] Would Add:** **${schedule.canonicalTitle}** (Platform: ${schedule.platformInfo?.emoji || '📺'} ${schedule.platform}, Recurrence: ${schedule.recurrenceLabel}, Simulcast: ${schedule.simulcastStr})`)
          continue
        }

        if (!canModifyCalendar) {
          results.push(`- 📝 **[NEEDS WRITER ACCESS] Would Add:** **${schedule.canonicalTitle}** (Platform: ${schedule.platformInfo?.emoji || '📺'} ${schedule.platform}, Recurrence: ${schedule.recurrenceLabel}, Simulcast: ${schedule.simulcastStr})`)
          continue
        }

        // Create on Google Calendar using the shared scheduler
        try {
          const calRes = await scheduleAnimeOnCalendar({
            calendarTarget,
            schedule,
            existingEvents: activeCalendarEvents,
            context,
            bot,
            channel
          })

          if (calRes.success) {
            addedToCalendar.push(`- ✅ **${schedule.canonicalTitle}** (${schedule.platformInfo?.emoji || '📺'} ${schedule.platform}, ${schedule.simulcastStr}, ${schedule.recurrenceLabel})`)
            results.push(`- ✅ **Added to Calendar:** **${schedule.canonicalTitle}** (${schedule.platformInfo?.emoji || '📺'} ${schedule.platform}, ${schedule.simulcastStr}, ${schedule.recurrenceLabel})`)
          } else {
            syncErrors.push({ title: schedule.canonicalTitle, error: calRes.error || 'Calendar addition failed' })
            results.push(`- ❌ **Failed to add ${schedule.canonicalTitle}:** ${calRes.error || 'Calendar addition failed'}`)
          }
        } catch (err) {
          if (err.response?.status === 403) {
            syncErrors.push({ title: schedule.canonicalTitle, error: 'Permission Required (needs writer access)' })
            results.push(`- ⚠️ **Permission Required for ${schedule.canonicalTitle}:** Service account needs \`writer\` permission on calendar "${calendar.summary}".`)
          } else {
            syncErrors.push({ title: schedule.canonicalTitle, error: err.message })
            results.push(`- ❌ **Failed to add ${schedule.canonicalTitle}:** ${err.message}`)
          }
        }
      }

      const hasAdditions = addedToCalendar.length > 0
      const hasSignificantUpdates = hasAdditions || scheduleShifted.length > 0
      const isSilentMode = Boolean(params.silent || params.silent_if_no_additions || (context && context.isScheduled))

      const summaryText = `🎌 **MyAnimeList / Crunchyroll Watchlist Sync (${username})**\n` +
        `Target Calendar: **${calendarTarget}**\n\n` +
        results.join('\n')

      if (context && context.isScheduled && channel && typeof channel.send === 'function') {
        if (hasAdditions || scheduleShifted.length > 0) {
          const updateText = '🎌 **Anime Watchlist Daily Update**\n\n' +
            (addedToCalendar.length > 0 ? `✨ **New Additions Starting / Scheduled:**\n${addedToCalendar.join('\n')}\n\n` : '') +
            (scheduleShifted.length > 0 ? `🔄 **Broadcast Schedule Shifts:**\n${scheduleShifted.join('\n')}\n\n` : '') +
            (endedTruncated.length > 0 ? `🛑 **Ended Series Future Events Cleared:**\n${endedTruncated.map(t => `- 🛑 **${t}**: Finished airing`).join('\n')}\n` : '')
          await channel.send(updateText).catch(e => logger.warn(`anime_sync: Failed to send scheduled update: ${e.message}`))
        }
      }

      if (isSilentMode && !hasSignificantUpdates) {
        logger.info('anime_sync: Daily sync completed silently — no new additions or schedule shifts.')
        return '[SYSTEM: Anime sync completed silently — no new additions or schedule shifts.]'
      }

      if (params.structured) {
        return {
          username,
          calendarTarget,
          totalEvaluated: toProcess.length,
          airingCount: toProcess.filter(i => i.anime_airing_status === 1).length,
          upcomingCount: toProcess.filter(i => i.anime_airing_status === 3).length,
          alreadyPresent,
          addedToCalendar,
          pendingBroadcast,
          scheduleShifted,
          endedTruncated,
          errors: syncErrors,
          summaryText
        }
      }

      return summaryText
    }

    // ─────────────────────────────────────────────────────────────
    // Operation: check_ended_series
    // ─────────────────────────────────────────────────────────────
    if (operation === 'check_ended_series') {
      const confirmDelete = Boolean(params.confirm_delete)

      // Query upcoming/active events on the target calendar
      const token = await googleCalendar.getAccessToken()
      const calendar = await googleCalendar.resolveCalendar(calendarTarget)
      let events = []
      try {
        let pageToken = null
        do {
          const res = await axios.get(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`,
            {
              headers: { Authorization: `Bearer ${token}` },
              params: { maxResults: 250, pageToken }
            }
          )
          const items = res.data?.items || []
          events = events.concat(items)
          pageToken = res.data?.nextPageToken
        } while (pageToken)
      } catch (err) {
        logger.warn(`anime_sync: Failed to fetch calendar events in check_ended_series: ${err.message}`)
      }
      const recurringEvents = events.filter(e => e.recurrence && e.recurrence.length > 0 && e.summary)

      if (recurringEvents.length === 0) {
        return `[SYSTEM: No recurring series events found on calendar "${calendar.summary || calendar.id}".]`
      }

      const endedSeries = []
      const activeSeries = []
      const manualOrUncertain = []

      for (const event of recurringEvents) {
        const title = event.summary
        const isSkynetCreated = Boolean(event.extendedProperties?.private?.source === 'skynet')

        await new Promise(resolve => setTimeout(resolve, 120))
        const media = await module.exports.getAnimeDetails(title)
        if (!media) {
          manualOrUncertain.push({ title, reason: 'No AniList match (likely manual entry, preserved)' })
          continue
        }

        // Strict verification: Status MUST be FINISHED, nextAiringEpisode must be null,
        // and final episode ended in the past
        const isFinished = media.status === 'FINISHED'
        const hasNoUpcoming = !media.nextAiringEpisode

        if (isFinished && hasNoUpcoming) {
          endedSeries.push({
            event,
            media,
            title,
            isSkynetCreated
          })
        } else {
          activeSeries.push({
            title,
            status: media.status,
            nextEp: media.nextAiringEpisode?.episode
          })
        }
      }

      const report = []
      report.push(`🔍 **Anime Seasonal Run Audit (${calendar.summary || calendar.id})**\n`)

      if (endedSeries.length === 0) {
        report.push('✅ **No series have completed their seasonal run.** All tracked anime are still active or upcoming.')
      } else {
        report.push(`🏁 **Confirmed Completed Series (${endedSeries.length}):**`)
        for (const item of endedSeries) {
          const ownershipLabel = item.isSkynetCreated ? '🤖 Skynet Event' : '👤 Manual Event'
          if (confirmDelete) {
            try {
              await module.exports.truncateFutureOccurrences(calendar.id, item.event, item.media, token)
              report.push(`- 🛑 **Future Events Cleared:** **${item.title}** (Season complete: ${item.media.episodes || '?'} episodes aired; historical airings preserved, ${ownershipLabel})`)
              const isInteractive = Boolean(context?.interaction || context?.isInteractive)
              const isScheduled = Boolean(context?.isScheduled || params?.isScheduled)
              const shouldNotifyDm = params?.notify_dm !== undefined
                ? Boolean(params.notify_dm)
                : (isScheduled && !isInteractive)

              if (shouldNotifyDm) {
                await googleCalendar.notifyOwnerDm(`📅 **Anime Calendar Update**\n🛑 **Ended Series Recurrence Stopped:** **${item.title}** (Historical entries preserved)`, bot)
              }
            } catch (delErr) {
              report.push(`- ⚠️ Failed to update ${item.title}: ${delErr.message}`)
            }
          } else {
            report.push(`- 🛑 **Ready to Clear Future Events:** **${item.title}** (${item.media.episodes || '?'} episodes aired, status: FINISHED, ${ownershipLabel})`)
          }
        }
        if (!confirmDelete) {
          report.push('\n💡 *To clear future occurrences of these completed entries, rerun with `confirm_delete: true`.*')
        }
      }

      if (activeSeries.length > 0) {
        report.push('\n📺 **Still Airing / Scheduled:**')
        activeSeries.slice(0, 10).forEach(s => {
          report.push(`- ▶️ **${s.title}** (Status: ${s.status}${s.nextEp ? `, Next: Ep ${s.nextEp}` : ''})`)
        })
      }

      if (manualOrUncertain.length > 0) {
        report.push('\n🛡️ **Protected Manual / Unmatched Entries:**')
        manualOrUncertain.slice(0, 5).forEach(m => {
          report.push(`- 🔒 **${m.title}**: ${m.reason}`)
        })
      }

      return report.join('\n')
    }

    // ─────────────────────────────────────────────────────────────
    // Operation: update_calendar_colors
    // ─────────────────────────────────────────────────────────────
    if (operation === 'update_calendar_colors') {
      const token = await googleCalendar.getAccessToken()
      const calendar = await googleCalendar.resolveCalendar(calendarTarget)
      const res = await axios.get(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?maxResults=250`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const events = res.data?.items || []
      const updatedList = []

      for (const event of events) {
        if (!event.summary || event.colorId) continue

        let detectedPlatform = null
        const desc = (event.description || '').toLowerCase()
        if (desc.includes('crunchyroll')) detectedPlatform = 'crunchyroll'
        else if (desc.includes('hidive')) detectedPlatform = 'hidive'
        else if (desc.includes('disney')) detectedPlatform = 'disney+'
        else if (desc.includes('netflix')) detectedPlatform = 'netflix'
        else if (desc.includes('hulu')) detectedPlatform = 'hulu'

        if (!detectedPlatform) {
          await new Promise(resolve => setTimeout(resolve, 100))
          const media = await module.exports.getAnimeDetails(event.summary)
          if (media) {
            const pInfo = getStreamingPlatformInfo(media)
            if (pInfo && pInfo.key !== 'default') detectedPlatform = pInfo.key
          }
        }

        if (detectedPlatform) {
          const colorId = googleCalendar.resolveColorId(detectedPlatform)
          if (colorId) {
            if (!dryRun) {
              await axios.patch(
                `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(event.id)}`,
                { colorId },
                { headers: { Authorization: `Bearer ${token}` } }
              )
            }
            updatedList.push(`- 🎨 **${event.summary}** -> ${detectedPlatform} (Color ID: \`${colorId}\`)`)
          }
        }
      }

      return `🎨 **Calendar Color Update (${calendar.summary || calendar.id})**\n` +
        (dryRun ? '*(DRY RUN - No changes saved)*\n\n' : '\n') +
        (updatedList.length > 0 ? updatedList.join('\n') : 'All eligible events already have colors assigned.')
    }

    throw new Error(`Unknown operation: "${operation}". Supported operations: "sync_watchlist", "check_ended_series", "update_calendar_colors".`)
  },
  getAnimeDetails,
  fetchMalList,
  formatCstSchedule,
  getCrunchyrollInfo,
  getStreamingPlatformInfo,
  isDubEntry,
  isTitleOnCalendar,
  extractSeasonNumber,
  extractMalIdFromEvent,
  resolveAnimeSchedule,
  scheduleAnimeOnCalendar,
  truncateFutureOccurrences,
  detectAndApplyScheduleDrift,
  calculateSeriesEndDate
}
