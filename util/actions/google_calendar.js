const axios = require('axios')
const path = require('path')
const fs = require('fs')
const chrono = require('chrono-node')
const { JWT } = require('google-auth-library')
const logger = require('../../logger')

let cachedToken = null
let tokenExpiry = 0

/**
 * Load Google Service Account credentials from env or credentials file.
 */
function getCredentials () {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY)
    } catch (e) {
      logger.warn(`google_calendar: Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY: ${e.message}`)
    }
  }

  if (process.env.GOOGLE_CALENDAR_CLIENT_EMAIL && process.env.GOOGLE_CALENDAR_PRIVATE_KEY) {
    return {
      client_email: process.env.GOOGLE_CALENDAR_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_CALENDAR_PRIVATE_KEY.replace(/\\n/g, '\n')
    }
  }

  const candidatePaths = [
    process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
    path.join(__dirname, '../../credentials/google_service_account.json'),
    path.join(__dirname, '../../service-account.json')
  ].filter(Boolean)

  for (const p of candidatePaths) {
    const resolvedPath = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
    if (fs.existsSync(resolvedPath)) {
      try {
        const raw = fs.readFileSync(resolvedPath, 'utf8')
        return JSON.parse(raw)
      } catch (e) {
        logger.warn(`google_calendar: Failed to parse credentials at ${resolvedPath}: ${e.message}`)
      }
    }
  }

  return null
}

const STREAMING_SERVICE_COLORS = {
  crunchyroll: '6', // Tangerine / Orange (#ffb878)
  netflix: '11', // Tomato / Red (#dc2127)
  hidive: '9', // Blueberry / Blue (#5484ed)
  hulu: '10', // Basil / Green (#51b749)
  disney: '7', // Peacock / Teal (#46d6db)
  'disney+': '7',
  disneyplus: '7',
  prime: '1', // Lavender / Light Blue (#a4bdfc)
  'prime video': '1',
  amazon: '1',
  youtube: '11', // Red (#dc2127)
  max: '3', // Grape / Purple (#dbadff)
  hbo: '3'
}

/**
 * Resolve streaming service or color name/ID to Google Calendar colorId.
 */
function resolveColorId (serviceOrColor) {
  if (!serviceOrColor) return undefined
  const clean = serviceOrColor.toString().trim().toLowerCase()
  if (STREAMING_SERVICE_COLORS[clean]) return STREAMING_SERVICE_COLORS[clean]
  if (/^[1-9]$|^1[0-1]$/.test(clean)) return clean
  return undefined
}

/**
 * Build Google Calendar RRULE recurrence array from parameters.
 */
function buildRecurrence (params) {
  if (Array.isArray(params.recurrence) && params.recurrence.length > 0) {
    return params.recurrence
  }
  if (typeof params.recurrence === 'string' && params.recurrence.trim()) {
    return [params.recurrence.trim()]
  }

  // Recur until specific date takes priority over continuing / seasonal_run
  if (params.until) {
    const untilDate = chrono.parseDate(params.until) || new Date(Date.parse(params.until))
    if (untilDate && !isNaN(untilDate.getTime())) {
      const y = untilDate.getUTCFullYear()
      const m = String(untilDate.getUTCMonth() + 1).padStart(2, '0')
      const d = String(untilDate.getUTCDate()).padStart(2, '0')
      let bydayPart = ''
      if (params.byday) {
        bydayPart = `;BYDAY=${params.byday}`
      } else if (params.start) {
        const startDate = chrono.parseDate(params.start) || new Date(Date.parse(params.start))
        if (startDate && !isNaN(startDate.getTime())) {
          const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
          bydayPart = `;BYDAY=${days[startDate.getUTCDay()]}`
        }
      }
      return [`RRULE:FREQ=WEEKLY;UNTIL=${y}${m}${d}T235959Z${bydayPart}`]
    }
  }

  // Continuing / ongoing weekly indefinitely
  if (params.continuing) {
    return ['RRULE:FREQ=WEEKLY']
  }

  // Seasonal run (default ~12 episodes / 1 cour) or explicit episode count
  if (params.seasonal_run || params.episodes_count) {
    const count = parseInt(params.episodes_count, 10) || 12
    return [`RRULE:FREQ=WEEKLY;COUNT=${count}`]
  }

  return undefined
}

/**
 * Format event description following existing anime calendar conventions.
 */
function formatDescription (params) {
  const parts = []
  if (params.streaming_service) {
    parts.push(`Streaming Service: ${params.streaming_service}`)
  }
  if (params.simulcast) {
    parts.push(`Simulcast: ${params.simulcast}`)
  }
  if (params.link || params.url) {
    parts.push(params.link || params.url)
  }
  if (params.description) {
    const existingDesc = params.description.trim()
    if (!parts.some(p => existingDesc.includes(p))) {
      parts.push(existingDesc)
    }
  }
  return parts.join('\n')
}

/**
 * Send notification DM to the bot owner on Discord.
 */
async function notifyOwnerDm (message, bot) {
  try {
    const ownerId = process.env.OWNER_ID
    if (!ownerId) return

    const client = bot?.users ? bot : bot?.client?.users ? bot.client : null
    if (client && typeof client.users?.fetch === 'function') {
      const owner = await client.users.fetch(ownerId).catch(() => null)
      if (owner && typeof owner.send === 'function') {
        await owner.send(message).catch(err => {
          logger.warn(`google_calendar: Failed to send DM to owner (${ownerId}): ${err.message}`)
        })
      }
    }
  } catch (err) {
    logger.warn(`google_calendar: notifyOwnerDm error: ${err.message}`)
  }
}

/**
 * Obtain a valid OAuth access token using Google Service Account JWT.
 */
async function getAccessToken () {
  const now = Date.now()
  if (cachedToken && tokenExpiry > now + 60_000) {
    return cachedToken
  }

  const creds = getCredentials()
  if (!creds || !creds.client_email || !creds.private_key) {
    throw new Error('Google Service Account credentials not found. Configure credentials/google_service_account.json or GOOGLE_SERVICE_ACCOUNT_KEY in .env.')
  }

  const client = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar']
  })

  const res = await client.getAccessToken()
  cachedToken = res.token
  // Default to 50 minutes lifetime if not specified
  tokenExpiry = now + 50 * 60 * 1000
  return cachedToken
}

/**
 * Fetch list of calendars accessible by this service account.
 */
async function getCalendarList () {
  const token = await module.exports.getAccessToken()
  const res = await axios.get('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${token}` }
  })
  return res.data?.items || []
}

/**
 * Resolve calendar target by ID or name (case-insensitive partial match).
 */
async function resolveCalendar (targetNameOrId) {
  const target = (targetNameOrId || process.env.GOOGLE_CALENDAR_DEFAULT || 'Anime Releases').trim()
  const isCalendarId = target.includes('@') || target === 'primary'

  let calendars = []
  try {
    calendars = await module.exports.getCalendarList()
  } catch (e) {
    logger.warn(`google_calendar: Failed to fetch calendar list: ${e.message}`)
  }

  if (calendars.length > 0) {
    // 1. Direct ID match
    const directMatch = calendars.find(c => c.id === target)
    if (directMatch) return directMatch

    // 2. Exact name match (case-insensitive)
    const exactMatch = calendars.find(c => c.summary && c.summary.toLowerCase() === target.toLowerCase())
    if (exactMatch) return exactMatch

    // 3. Substring match either way (e.g. 'Anime Release' vs 'Anime Releases')
    const partialMatch = calendars.find(c => c.summary && (
      c.summary.toLowerCase().includes(target.toLowerCase()) ||
      target.toLowerCase().includes(c.summary.toLowerCase())
    ))
    if (partialMatch) return partialMatch
  }

  // If target is an explicit calendar ID and wasn't in calendarList, try fetching it directly
  if (isCalendarId) {
    try {
      const token = await module.exports.getAccessToken()
      const res = await axios.get(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.data && res.data.id) {
        return {
          id: res.data.id,
          summary: res.data.summary || target
        }
      }
    } catch (e) {
      logger.warn(`google_calendar: Failed to fetch calendar by direct ID "${target}": ${e.message}`)
    }
  }

  if (calendars.length === 0) {
    const creds = getCredentials()
    const email = creds?.client_email || 'your-service-account@...iam.gserviceaccount.com'
    throw new Error(`No calendars are currently shared with this service account (${email}). Open Google Calendar > Settings > Share with specific people > add "${email}" with "Make changes to events" permission.`)
  }

  return calendars[0]
}

/**
 * Search calendar for an existing event matching title or MAL ID.
 * Prevents creating duplicate entries for the same show/season.
 */
async function findExistingEvent (calendarId, title, malId) {
  if (!calendarId || !title) return null
  try {
    const token = await module.exports.getAccessToken()
    if (!token) return null
    const authHeaders = { Authorization: `Bearer ${token}` }

    const cleanTitle = title.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
    const queryParams = new URLSearchParams({
      q: cleanTitle,
      maxResults: '10'
    })

    const res = await axios.get(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${queryParams.toString()}`,
      { headers: authHeaders, timeout: 8000 }
    )
    const items = res.data?.items || []
    if (items.length === 0) return null

    const normalize = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const targetNorm = normalize(title)
    const targetSeasonMatch = title.match(/season\s*(\d+)/i) || title.match(/(\d+)(?:st|nd|rd|th)\s*season/i)
    const targetSeason = targetSeasonMatch ? targetSeasonMatch[1] : null

    for (const item of items) {
      if (item.status === 'cancelled') continue

      // 1. Match by private extendedProperties MAL ID if present
      const privMalId = item.extendedProperties?.private?.idMal || item.extendedProperties?.private?.mal_id
      if (malId && privMalId && String(privMalId) === String(malId)) {
        return item
      }

      // 2. Exact normalized summary match
      const itemNorm = normalize(item.summary)
      if (itemNorm === targetNorm) {
        return item
      }

      // 3. Match season numbers and title prefix if applicable
      const itemSeasonMatch = (item.summary || '').match(/season\s*(\d+)/i) || (item.summary || '').match(/(\d+)(?:st|nd|rd|th)\s*season/i)
      const itemSeason = itemSeasonMatch ? itemSeasonMatch[1] : null
      if (targetSeason && itemSeason) {
        if (targetSeason === itemSeason && (itemNorm.includes(targetNorm.slice(0, 15)) || targetNorm.includes(itemNorm.slice(0, 15)))) {
          return item
        }
      } else if (!targetSeason && !itemSeason) {
        if (itemNorm.includes(targetNorm) || targetNorm.includes(itemNorm)) {
          return item
        }
      }
    }
  } catch (err) {
    logger.warn(`google_calendar: findExistingEvent check failed: ${err.message}`)
  }
  return null
}

module.exports = {
  name: 'google_calendar',
  description: 'Manage Google Calendar events (create, list, delete) with support for specific calendars like "Anime Releases".',
  ownerOnly: true,
  schema: {
    operation: 'Operation: "create_event", "update_event", "list_events", "delete_event", or "list_calendars"',
    summary: 'Title of the event (required for create_event)',
    start: 'Start time (natural language like "tomorrow at 3pm", ISO string, or relative time)',
    end: 'End time (optional, defaults to start + duration_minutes)',
    duration_minutes: 'Duration in minutes (default 30)',
    description: 'Detailed description, episode notes, links, or release info',
    calendar: 'Target calendar name or ID (defaults to "Anime Release")',
    streaming_service: 'Streaming platform ("crunchyroll", "netflix", "hidive", "hulu", "disney+", "prime") to auto-set color and metadata',
    color_id: 'Direct Google Calendar color ID ("1" to "11")',
    seasonal_run: 'Boolean: true to repeat weekly for current season (~12 episodes)',
    continuing: 'Boolean: true if anime keeps airing indefinitely (repeats weekly)',
    episodes_count: 'Number of episodes in seasonal run (e.g. 12, 13, 24)',
    simulcast: 'Simulcast schedule string (e.g. "Saturdays at 11:30 AM CST")',
    link: 'Direct streaming URL to include in notes',
    all_day: 'Boolean: true for all-day date event',
    recurrence: 'Raw RRULE recurrence string or array (optional)',
    time_min: 'Start time for listing events (default now)',
    time_max: 'End time for listing events (default 7 days from now)',
    max_results: 'Maximum events to return (default 10)',
    query: 'Search query for filtering events or finding an event to update/delete',
    event_id: 'Specific Google Calendar Event ID to update or delete'
  },
  execute: async (bot, channel, params, context) => {
    const operation = (params.operation || 'create_event').toLowerCase()
    const token = await module.exports.getAccessToken()
    const authHeaders = { Authorization: `Bearer ${token}` }

    // ─────────────────────────────────────────────────────────────
    // Operation: list_calendars
    // ─────────────────────────────────────────────────────────────
    if (operation === 'list_calendars') {
      const calendars = await module.exports.getCalendarList()
      if (calendars.length === 0) {
        const creds = getCredentials()
        return `[SYSTEM: No calendars are currently shared with service account "${creds?.client_email}". Please share your "Anime Releases" calendar with this email address in Google Calendar settings.]`
      }

      const list = calendars.map(c => `- **${c.summary || 'Untitled'}** (ID: \`${c.id}\`, Role: \`${c.accessRole}\`)`).join('\n')
      return `[SYSTEM: ACCESSIBLE GOOGLE CALENDARS]:\n${list}`
    }

    // Resolve target calendar
    const calendar = await module.exports.resolveCalendar(params.calendar)
    const calendarId = calendar.id
    const calendarTitle = calendar.summary || calendarId

    // ─────────────────────────────────────────────────────────────
    // Operation: create_event
    // ─────────────────────────────────────────────────────────────
    if (operation === 'create_event') {
      const summary = params.summary || params.title
      if (!summary) {
        throw new Error('Event "summary" (title) is required to create a calendar event.')
      }

      const startRaw = params.start || params.when || 'now'
      let startDate = chrono.parseDate(startRaw)
      if (!startDate) {
        const parsed = Date.parse(startRaw)
        if (!isNaN(parsed)) startDate = new Date(parsed)
      }
      if (!startDate) {
        throw new Error(`Could not parse start time: "${startRaw}". Try natural language like "tomorrow at 10am" or an ISO date.`)
      }

      const durationMinutes = parseInt(params.duration_minutes, 10) || 30
      let endDate = null
      if (params.end) {
        endDate = chrono.parseDate(params.end) || new Date(Date.parse(params.end))
      }
      if (!endDate || isNaN(endDate.getTime())) {
        endDate = new Date(startDate.getTime() + durationMinutes * 60_000)
      }

      const isAllDay = Boolean(params.all_day || /^\d{4}-\d{2}-\d{2}$/.test(startRaw.trim()))
      let startObj
      let endObj

      if (isAllDay) {
        const ymd = startDate.toISOString().split('T')[0]
        const nextDay = new Date(startDate.getTime() + 86_400_000).toISOString().split('T')[0]
        startObj = { date: ymd }
        endObj = { date: nextDay }
      } else {
        const timeZone = params.timeZone || params.timezone || 'America/Chicago'
        startObj = { dateTime: startDate.toISOString(), timeZone }
        endObj = { dateTime: endDate.toISOString(), timeZone }
      }

      const requestDescription = formatDescription(params)
      const colorId = resolveColorId(params.streaming_service || params.color || params.color_id)
      const recurrence = buildRecurrence(params)

      const requestBody = {
        summary,
        description: requestDescription,
        start: startObj,
        end: endObj,
        extendedProperties: {
          private: {
            source: 'skynet',
            streaming_service: params.streaming_service || '',
            ...(params.mal_id || params.idMal ? { mal_id: String(params.mal_id || params.idMal), idMal: String(params.mal_id || params.idMal) } : {})
          }
        }
      }

      if (colorId) requestBody.colorId = colorId
      if (recurrence) requestBody.recurrence = recurrence

      logger.info(`google_calendar: Creating event "${summary}" on "${calendarTitle}" (${calendarId}) [colorId: ${colorId || 'default'}, recurrence: ${recurrence ? recurrence[0] : 'none'}]`)
      const res = await axios.post(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        requestBody,
        { headers: authHeaders }
      )

      const created = res.data
      const eventLink = created.htmlLink || `https://calendar.google.com/calendar/u/0/r/eventedit/${created.id}`
      const confirmationMsg = `✅ **Added to Google Calendar (${calendarTitle})**\n` +
        `📅 **Event:** ${created.summary}\n` +
        (created.colorId ? `🎨 **Platform Color ID:** \`${created.colorId}\`\n` : '') +
        (created.recurrence ? `🔁 **Recurrence:** \`${created.recurrence.join(', ')}\`\n` : '') +
        `⏰ **Start:** ${isAllDay ? startObj.date : startDate.toLocaleString()}\n` +
        (created.description ? `📝 **Notes:**\n${created.description}\n` : '') +
        `🔗 [View in Google Calendar](${eventLink})`

      const isInteractive = Boolean(context?.interaction || context?.isInteractive)
      const isScheduled = Boolean(context?.isScheduled || params?.isScheduled)
      const shouldNotifyDm = params?.notify_dm !== undefined
        ? Boolean(params.notify_dm)
        : (isScheduled && !isInteractive)

      if (shouldNotifyDm) {
        await module.exports.notifyOwnerDm(`📅 **Anime Calendar Update**\n${confirmationMsg}`, bot)
      }
      return confirmationMsg
    }

    // ─────────────────────────────────────────────────────────────
    // Operation: update_event
    // ─────────────────────────────────────────────────────────────
    if (operation === 'update_event') {
      let targetEventId = params.event_id
      if (!targetEventId && (params.query || params.summary)) {
        const searchQ = (params.query || params.summary).toLowerCase().trim()
        const searchRes = await axios.get(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?q=${encodeURIComponent(searchQ)}&maxResults=5`,
          { headers: authHeaders }
        )
        const items = searchRes.data?.items || []
        const match = items.find(e => e.summary && e.summary.toLowerCase().includes(searchQ))
        if (match) targetEventId = match.id
      }

      if (!targetEventId) {
        throw new Error('Please specify an "event_id" or "query" to find the event to update.')
      }

      const patchBody = {}
      if (params.summary || params.title) patchBody.summary = params.summary || params.title

      const newColor = resolveColorId(params.streaming_service || params.color || params.color_id)
      if (newColor) patchBody.colorId = newColor

      if (params.description || params.streaming_service || params.simulcast || params.link) {
        patchBody.description = formatDescription(params)
      }

      const newRecurrence = buildRecurrence(params)
      if (newRecurrence) patchBody.recurrence = newRecurrence

      if (params.start) {
        const newStart = chrono.parseDate(params.start) || new Date(Date.parse(params.start))
        if (newStart && !isNaN(newStart.getTime())) {
          const durationMin = parseInt(params.duration_minutes, 10) || 30
          const newEnd = params.end ? (chrono.parseDate(params.end) || new Date(Date.parse(params.end))) : new Date(newStart.getTime() + durationMin * 60_000)
          patchBody.start = { dateTime: newStart.toISOString() }
          patchBody.end = { dateTime: newEnd.toISOString() }
        }
      }

      if (params.mal_id || params.idMal || params.streaming_service) {
        patchBody.extendedProperties = {
          private: {
            source: 'skynet',
            ...(params.streaming_service ? { streaming_service: params.streaming_service } : {}),
            ...(params.mal_id || params.idMal ? { mal_id: String(params.mal_id || params.idMal), idMal: String(params.mal_id || params.idMal) } : {})
          }
        }
      }

      logger.info(`google_calendar: Updating event ID "${targetEventId}" on "${calendarTitle}" (${calendarId})`)
      const patchRes = await axios.patch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(targetEventId)}`,
        patchBody,
        { headers: authHeaders }
      )

      const updated = patchRes.data
      return `✏️ **Updated Google Calendar Event (${calendarTitle})**\n` +
        `📅 **Event:** ${updated.summary}\n` +
        (updated.colorId ? `🎨 **Color ID:** \`${updated.colorId}\`\n` : '') +
        (updated.recurrence ? `🔁 **Recurrence:** \`${updated.recurrence.join(', ')}\`\n` : '') +
        (updated.description ? `📝 **Notes:**\n${updated.description}\n` : '')
    }

    // ─────────────────────────────────────────────────────────────
    // Operation: list_events
    // ─────────────────────────────────────────────────────────────
    if (operation === 'list_events') {
      let minDate = params.time_min ? chrono.parseDate(params.time_min) : new Date()
      if (!minDate || isNaN(minDate.getTime())) minDate = new Date()

      let maxDate = params.time_max ? chrono.parseDate(params.time_max) : new Date(minDate.getTime() + 7 * 86_400_000)
      if (!maxDate || isNaN(maxDate.getTime())) maxDate = new Date(minDate.getTime() + 7 * 86_400_000)

      const maxResults = parseInt(params.max_results, 10) || 10
      const queryParams = new URLSearchParams({
        timeMin: minDate.toISOString(),
        timeMax: maxDate.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: String(maxResults)
      })

      if (params.query) {
        queryParams.append('q', params.query)
      }

      logger.info(`google_calendar: Listing events on "${calendarTitle}" (${calendarId})`)
      const res = await axios.get(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${queryParams.toString()}`,
        { headers: authHeaders }
      )

      const events = res.data?.items || []
      if (events.length === 0) {
        return `[SYSTEM: UPCOMING EVENTS ON "${calendarTitle}"]: None scheduled between ${minDate.toLocaleDateString()} and ${maxDate.toLocaleDateString()}.`
      }

      const list = events.map(e => {
        const startStr = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleString() : (e.start?.date || 'All Day')
        const colorTag = e.colorId ? ` [Color: ${e.colorId}]` : ''
        const simulcastTag = e.extendedProperties?.private?.streaming_service
          ? ` — Streaming: ${e.extendedProperties.private.streaming_service}`
          : (e.description?.includes('Simulcast:') ? ` — ${e.description.split('\n').find(l => l.includes('Simulcast:'))?.trim()}` : '')
        return `- **${e.summary || 'Untitled'}** (Starts: ${startStr}, ID: \`${e.id}\`)${colorTag}${simulcastTag}`
      }).join('\n')

      return `[SYSTEM: UPCOMING EVENTS ON "${calendarTitle}"]:\n${list}`
    }

    // ─────────────────────────────────────────────────────────────
    // Operation: delete_event
    // ─────────────────────────────────────────────────────────────
    if (operation === 'delete_event') {
      let targetEventId = params.event_id

      if (!targetEventId && (params.query || params.summary)) {
        const searchQ = (params.query || params.summary).trim()
        const queryParams = new URLSearchParams({
          q: searchQ,
          maxResults: '5'
        })
        const searchRes = await axios.get(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${queryParams.toString()}`,
          { headers: authHeaders }
        )
        const matches = searchRes.data?.items || []
        if (matches.length > 0) {
          targetEventId = matches[0].id
          logger.info(`google_calendar: Found event "${matches[0].summary}" matching query "${searchQ}" with ID: ${targetEventId}`)
        }
      }

      if (!targetEventId) {
        if (params.query || params.summary) {
          throw new Error(`No calendar event found matching "${params.query || params.summary}".`)
        }
        throw new Error('Please specify an "event_id" or "query" to find the event to delete.')
      }

      await axios.delete(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(targetEventId)}`,
        { headers: authHeaders }
      )

      const delMsg = `🗑️ **Event Deleted from Google Calendar (${calendarTitle})**: \`${targetEventId}\``
      const isInteractive = Boolean(context?.interaction || context?.isInteractive)
      const isScheduled = Boolean(context?.isScheduled || params?.isScheduled)
      const shouldNotifyDm = params?.notify_dm !== undefined
        ? Boolean(params.notify_dm)
        : (isScheduled && !isInteractive)

      if (shouldNotifyDm) {
        await module.exports.notifyOwnerDm(`📅 **Anime Calendar Update**\n${delMsg}`, bot)
      }
      return delMsg
    }

    throw new Error(`Unknown operation: "${operation}". Supported operations: "create_event", "update_event", "list_events", "delete_event", "list_calendars".`)
  },
  findExistingEvent,
  resolveCalendar,
  getCalendarList,
  getAccessToken,
  getCredentials,
  notifyOwnerDm,
  STREAMING_SERVICE_COLORS,
  resolveColorId,
  buildRecurrence,
  formatDescription
}
