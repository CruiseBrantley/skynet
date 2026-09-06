const malClient = require('../malClient')
const googleCalendar = require('./google_calendar')
const axios = require('axios')
const logger = require('../../logger')

module.exports = {
  name: 'animelist',
  description: 'Manage the server anime watchlist on MyAnimeList and Google Calendar (add, remove, list, seed, sync).',
  ownerOnly: false,
  schema: {
    operation: 'Operation: "add", "remove", "list", "seed", or "sync"',
    title: 'Anime title for add or remove',
    platform: 'Streaming platform (Crunchyroll, Netflix, HIDIVE, etc.)',
    episodes: 'Episode count override',
    status: 'MAL list status ("watching", "plan_to_watch", "completed")',
    sync_calendar: 'Boolean: whether to also schedule on Google Calendar (default: true)'
  },
  execute: async (bot, channel, params, context) => {
    // Normalise operation and title from varying LLM parameter patterns
    let operation = (params.operation || '').toLowerCase()
    let title = (params.title || '').trim()

    if (!operation) {
      if (params.add || params.title) {
        operation = 'add'
        title = (params.add || params.title || '').trim()
      } else if (params.remove) {
        operation = 'remove'
        title = (params.remove || '').trim()
      } else if (params.list !== undefined) {
        operation = 'list'
      } else if (params.seed !== undefined) {
        operation = 'seed'
      } else if (params.sync !== undefined) {
        operation = 'sync'
      } else {
        operation = 'list'
      }
    }

    const TARGET_GUILD_ID = '525112230006489091'
    const ANIME_CHANNEL_ID = process.env.ANIME_CHANNEL_ID || '1062784669034229780'
    const isOwner = Boolean(
      context?.isOwner ||
      (context?.userId && process.env.OWNER_ID && context.userId === process.env.OWNER_ID) ||
      (context?.interaction?.user?.id && process.env.OWNER_ID && context.interaction.user.id === process.env.OWNER_ID)
    )
    const currentGuildId = channel?.guildId || channel?.guild?.id || context?.guildId || context?.interaction?.guildId
    const currentChannelId = channel?.id || context?.channelId || context?.interaction?.channelId
    const isAllowedChannel = currentChannelId === ANIME_CHANNEL_ID

    if (currentGuildId && currentGuildId !== TARGET_GUILD_ID && !isOwner) {
      return `[SYSTEM: Permission denied. The animelist tool is only available in server ${TARGET_GUILD_ID}.]`
    }

    if (['add', 'remove', 'sync', 'seed'].includes(operation) && !isOwner && !isAllowedChannel) {
      return `[SYSTEM: Permission denied. Modifying the anime list is only allowed in channel #${ANIME_CHANNEL_ID} or with owner permissions.]`
    }

    if (operation === 'add') {
      if (!title) return '[SYSTEM: Missing anime title to add.]'
      const syncCalendar = params.sync_calendar !== false && params.sync_calendar !== 'false'

      try {
        const malRes = await malClient.addAnime(title, { status: 'watching' })
        let calStatus = ''

        if (syncCalendar) {
          try {
            const animeSync = require('./anime_sync')
            const animeDetails = malRes.media || await malClient.searchAnime(title)
            const schedule = await animeSync.resolveAnimeSchedule({
              title: animeDetails?.title || malRes.title || title,
              animeId: animeDetails?.id || malRes.animeId,
              animeInfo: animeDetails,
              media: animeDetails?.media,
              platformOverride: params.platform,
              episodesOverride: params.episodes
            })

            const calRes = await animeSync.scheduleAnimeOnCalendar({
              calendarTarget: process.env.GOOGLE_CALENDAR_DEFAULT || 'Anime Release',
              schedule,
              context: { ...context, isInteractive: true },
              bot,
              channel
            })

            if (calRes.pendingSchedule) {
              calStatus = ` Premiere date not yet confirmed (${calRes.timeDesc}) — will schedule on Google Calendar automatically when broadcast time is announced.`
            } else if (calRes.success) {
              calStatus = calRes.isUpdated
                ? ' Updated existing schedule on Anime Release Google Calendar.'
                : ' Also scheduled on Anime Release Google Calendar.'
            }
          } catch (cErr) {
            logger.warn(`actions/animelist: Calendar creation failed for "${title}": ${cErr.message}`)
          }
        }

        const publicUrl = malClient.getPublicUrl()
        return `[MAL Watchlist: Added "${malRes.title}" (MAL ID: ${malRes.animeId}) to Watching status on ${publicUrl}.${calStatus}]`
      } catch (err) {
        return `[MAL Watchlist Error: Failed to add "${title}": ${err.message}]`
      }
    }

    if (operation === 'remove') {
      if (!title) return '[SYSTEM: Missing anime title to remove.]'
      try {
        await malClient.removeAnime(title)
        return `[MAL Watchlist: Removed "${title}" from watchlist.]`
      } catch (err) {
        return `[MAL Watchlist Error: Failed to remove "${title}": ${err.message}]`
      }
    }

    if (operation === 'list') {
      const filter = (params.filter || params.status || 'airing').toLowerCase()
      try {
        let malStatus = 'watching'
        if (filter === 'completed') malStatus = 'completed'
        else if (filter === 'plan_to_watch') malStatus = 'plan_to_watch'

        const fullList = await malClient.getUserList(malStatus)
        if (!fullList || fullList.length === 0) {
          return `[MAL Watchlist: 0 anime found in "${malStatus}" list on MyAnimeList.]`
        }

        let displayed = fullList
        let header = 'Currently Airing'
        if (filter === 'airing') {
          displayed = fullList.filter(i => i.anime_airing_status === 1 || i.airing_status === 1 || i.airing_status === 'currently_airing' || i.status === 'currently_airing')
          header = 'Currently Airing'
        } else if (filter === 'upcoming') {
          displayed = fullList.filter(i => i.anime_airing_status === 3 || i.airing_status === 3 || i.airing_status === 'not_yet_aired' || i.status === 'not_yet_aired')
          header = 'Upcoming'
        } else {
          header = 'All Tracked'
        }

        if (displayed.length === 0) {
          return `[MAL Watchlist: 0 series currently classified as "${header}" on MyAnimeList (${fullList.length} total on account). Use filter="all" to see all.]`
        }

        const animeSync = require('./anime_sync')
        const titlePromises = displayed.slice(0, 25).map(async (item, idx) => {
          const rawTitle = item.anime_title || item.title || 'Untitled'
          const malId = item.anime_id || item.id
          const totalEps = item.anime_num_episodes || item.episodes || '?'
          let displayTitle = item.english_title || rawTitle
          let prog = `(${totalEps} eps)`
          try {
            const details = await animeSync.getAnimeDetails(rawTitle, malId)
            if (details?.title?.english) {
              displayTitle = details.title.english
            }
            const nextEp = details?.nextAiringEpisode?.episode
            const canTotal = details?.episodes || totalEps
            if (nextEp) {
              prog = `(Aired: ${nextEp - 1}/${canTotal} eps • Next: Ep ${nextEp})`
            } else if (item.airing_status === 'currently_airing' || item.anime_airing_status === 1) {
              prog = `(Airing • ${canTotal} eps)`
            } else if (item.airing_status === 'not_yet_aired' || item.anime_airing_status === 3) {
              prog = `(Upcoming • ${canTotal} eps)`
            } else if (item.airing_status === 'finished_airing' || item.anime_airing_status === 2) {
              prog = `(${canTotal}/${canTotal} eps aired)`
            }
          } catch (_) {}
          return `${idx + 1}. ${displayTitle} ${prog}`
        })
        const titles = await Promise.all(titlePromises)
        return `[MAL Watchlist (${header.toUpperCase()} - showing ${displayed.length} of ${fullList.length} total)]:\n${titles.join('\n')}`
      } catch (err) {
        return `[MAL Watchlist Error: Failed to fetch list: ${err.message}]`
      }
    }

    if (operation === 'seed') {
      try {
        const token = await googleCalendar.getAccessToken()
        const calendar = await googleCalendar.resolveCalendar('Anime Release')
        const calRes = await axios.get(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?maxResults=250`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const rawTitles = [...new Set((calRes.data?.items || []).map(e => e.summary).filter(Boolean))]
        if (rawTitles.length === 0) {
          return '[MAL Watchlist: No events found on Anime Release calendar.]'
        }

        let addedCount = 0
        const failures = []
        for (const t of rawTitles) {
          try {
            await malClient.addAnime(t, { status: 'watching' })
            addedCount++
          } catch (_) {
            failures.push(t)
          }
        }
        return `[MAL Watchlist Seed Complete: Added ${addedCount}/${rawTitles.length} calendar series to Watching list.${failures.length > 0 ? ` Failed: ${failures.slice(0, 5).join(', ')}` : ''}]`
      } catch (err) {
        return `[MAL Watchlist Seed Error: ${err.message}]`
      }
    }

    if (operation === 'sync') {
      const animeSync = require('./anime_sync')
      return animeSync.execute(bot, channel, { operation: 'sync_watchlist' }, context)
    }

    return `[MAL Watchlist: Unknown operation "${operation}". Supported: add, remove, list, seed, sync]`
  }
}
