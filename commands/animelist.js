const { SlashCommandBuilder } = require('discord.js')
const { SafeEmbedBuilder: EmbedBuilder } = require('../util/discordFormatter')
const axios = require('axios')
const malClient = require('../util/malClient')
const ActionExecutor = require('../util/ActionExecutor')
const logger = require('../logger')

module.exports = {
  guildId: '525112230006489091',
  data: new SlashCommandBuilder()
    .setName('animelist')
    .setDescription('Manage the server anime watchlist on MyAnimeList and Google Calendar')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add an anime to the shared MAL watchlist and Google Calendar')
        .addStringOption(opt =>
          opt
            .setName('title')
            .setDescription('Anime title (e.g. Solo Leveling, Chainsaw Man, Frieren)')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('platform')
            .setDescription('Streaming service override')
            .setRequired(false)
            .addChoices(
              { name: 'Crunchyroll', value: 'Crunchyroll' },
              { name: 'HIDIVE', value: 'HIDIVE' },
              { name: 'Netflix', value: 'Netflix' },
              { name: 'Disney+', value: 'Disney+' },
              { name: 'Hulu', value: 'Hulu' },
              { name: 'Prime Video', value: 'Prime Video' }
            )
        )
        .addIntegerOption(opt =>
          opt
            .setName('episodes')
            .setDescription('Episode count (defaults to 12 or seasonal count)')
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt
            .setName('sync_calendar')
            .setDescription('Schedule on the Anime Release Google Calendar (default: true)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove an anime from the MAL watchlist and Google Calendar')
        .addStringOption(opt =>
          opt
            .setName('title')
            .setDescription('Anime title to remove')
            .setRequired(true)
        )
        .addBooleanOption(opt =>
          opt
            .setName('remove_calendar')
            .setDescription('Also delete from Google Calendar (default: true)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('Display currently airing series from the anime watchlist')
        .addStringOption(opt =>
          opt
            .setName('filter')
            .setDescription('Filter list (default: currently airing)')
            .setRequired(false)
            .addChoices(
              { name: 'Currently Airing (Default)', value: 'airing' },
              { name: 'Upcoming', value: 'upcoming' },
              { name: 'All Tracked Anime', value: 'all' },
              { name: 'Completed', value: 'completed' },
              { name: 'Plan to Watch', value: 'plan_to_watch' }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('sync')
        .setDescription('Sync the MAL watchlist to the Anime Google Calendar')
    )
    .addSubcommand(sub =>
      sub
        .setName('seed')
        .setDescription('Seed the MAL watchlist with all active series currently on Google Calendar')
    )
    .addSubcommand(sub =>
      sub
        .setName('auth')
        .setDescription('Connect MyAnimeList account (Owner)')
        .addStringOption(opt =>
          opt
            .setName('code')
            .setDescription('Paste the authorization code or redirect URL after authorizing on MAL')
            .setRequired(false)
        )
    ),

  execute: async (interaction) => {
    let subcommand = null
    try {
      subcommand = interaction.options.getSubcommand()
    } catch (_) {}

    if (!subcommand) {
      if (interaction.options.getString('add') || interaction.options.getString('title')) subcommand = 'add'
      else if (interaction.options.getString('remove')) subcommand = 'remove'
      else if (interaction.options.getString('list') !== null) subcommand = 'list'
      else if (interaction.options.getString('sync') !== null) subcommand = 'sync'
      else if (interaction.options.getString('seed') !== null) subcommand = 'seed'
      else subcommand = 'list'
    }

    if (subcommand === 'auth') {
      const isOwner = interaction.user?.id === process.env.OWNER_ID
      if (!isOwner) {
        await interaction.reply({
          content: '⛔ Only the bot owner can authorize the MyAnimeList account connection.',
          ephemeral: true
        })
        return
      }

      const rawCode = interaction.options.getString('code', false)
      if (rawCode) {
        let authCode = rawCode.trim()
        if (authCode.includes('code=')) {
          const match = authCode.match(/code=([^&]+)/)
          if (match) authCode = decodeURIComponent(match[1])
        }
        await interaction.deferReply({ ephemeral: true })
        try {
          await malClient.handleCallback(authCode)
          await interaction.editReply('✅ **Successfully connected to MyAnimeList!** Skynet can now manage the watchlist.')
        } catch (err) {
          await interaction.editReply(`❌ Failed to exchange authorization code: ${err.message}`)
        }
        return
      }

      try {
        const authUrl = malClient.getAuthUrl()
        const embed = new EmbedBuilder()
          .setTitle('🔗 Connect MyAnimeList Account')
          .setDescription(
            '**Step 1:** Click the link below to authorize on MyAnimeList:\n\n' +
            `👉 [**Authorize with MyAnimeList**](${authUrl})\n\n` +
            '**Step 2:** After clicking "Allow", your browser will redirect to a URL with `code=...`.\n' +
            'Copy that code (or the full redirect URL) and run:\n' +
            '`/animelist auth code: <paste_code_here>`\n\n' +
            '*(Or if on the same local network, open `http://192.168.50.133:3000/mal/login`)*'
          )
          .setColor(0x2e51a2)
          .setFooter({ text: 'MyAnimeList OAuth 2.0 PKCE' })

        await interaction.reply({ embeds: [embed], ephemeral: true })
      } catch (err) {
        await interaction.reply({ content: `Failed to generate MAL auth link: ${err.message}`, ephemeral: true })
      }
      return
    }

    const TARGET_GUILD_ID = '525112230006489091'
    const ANIME_CHANNEL_ID = process.env.ANIME_CHANNEL_ID || '1062784669034229780'
    const isOwner = Boolean(interaction.user?.id && process.env.OWNER_ID && interaction.user.id === process.env.OWNER_ID)

    if (interaction.guildId && interaction.guildId !== TARGET_GUILD_ID && !isOwner) {
      await interaction.reply({
        content: `⛔ The \`/animelist\` command is only available in server ${TARGET_GUILD_ID}.`,
        ephemeral: true
      })
      return
    }

    const isAllowedChannel = (
      interaction.channelId === ANIME_CHANNEL_ID ||
      interaction.channel?.id === ANIME_CHANNEL_ID
    )

    if (['add', 'remove', 'sync', 'seed'].includes(subcommand) && !isOwner && !isAllowedChannel) {
      await interaction.reply({
        content: `⛔ Modifying the anime list is only allowed in <#${ANIME_CHANNEL_ID}> or with owner permissions.`,
        ephemeral: true
      })
      return
    }

    await interaction.deferReply()

    if (subcommand === 'add') {
      const rawTitle = (
        interaction.options.getString('title', false) ||
        interaction.options.getString('add', false) ||
        ''
      ).trim()
      if (!rawTitle) {
        await interaction.editReply('❌ Missing anime title to add.')
        return
      }
      const platformOverride = interaction.options.getString('platform', false)
      const episodesOverride = interaction.options.getInteger('episodes', false)
      const shouldSyncCalendar = interaction.options.getBoolean('sync_calendar') !== false

      try {
        const animeInfo = await malClient.searchAnime(rawTitle)
        const canonicalTitle = animeInfo?.title || rawTitle
        const animeId = animeInfo?.id
        const coverImage = animeInfo?.coverImage

        let malStatusResult = null
        let malWarning = null

        if (malClient.isAuthenticated()) {
          try {
            malStatusResult = await malClient.addAnime(animeId || canonicalTitle, { status: 'watching' })
          } catch (malErr) {
            malWarning = `MAL update failed: ${malErr.message}`
            logger.warn(`animelist: ${malWarning}`)
          }
        } else {
          malWarning = 'MAL account not authenticated yet. Run /animelist auth to link.'
        }

        let calendarResult = null
        if (shouldSyncCalendar) {
          try {
            const animeSync = require('../util/actions/anime_sync')
            const schedule = await animeSync.resolveAnimeSchedule({
              title: canonicalTitle,
              animeId,
              animeInfo,
              media: animeInfo?.media,
              platformOverride,
              episodesOverride
            })

            const calRes = await animeSync.scheduleAnimeOnCalendar({
              calendarTarget: process.env.GOOGLE_CALENDAR_DEFAULT || 'Anime Release',
              schedule,
              context: { isOwner: true, isInteractive: true, interaction }
            })

            calendarResult = calRes
          } catch (calErr) {
            calendarResult = { error: calErr.message }
          }
        }

        const embed = new EmbedBuilder()
          .setTitle(`✨ Added to Watchlist: ${canonicalTitle}`)
          .setURL(malClient.getPublicUrl())
          .setColor(0x2ecc71)
          .setTimestamp()

        if (coverImage) {
          embed.setThumbnail(coverImage)
        }

        const descLines = []
        if (malStatusResult) {
          descLines.push('✅ **MyAnimeList:** Added to Watching list')
        } else if (malWarning) {
          descLines.push(`⚠️ **MyAnimeList:** ${malWarning}`)
        }

        if (calendarResult) {
          if (calendarResult.error) {
            descLines.push(`⚠️ **Calendar:** Failed to schedule (${calendarResult.error})`)
          } else if (calendarResult.pendingSchedule) {
            const timeInfo = calendarResult.timeDesc === 'Broadcast schedule unconfirmed'
              ? 'Broadcast schedule unconfirmed'
              : `Premiere date unconfirmed (${calendarResult.timeDesc})`
            descLines.push(`⏳ **Google Calendar:** ${timeInfo}\n   • Streaming on **${calendarResult.platform}**\n   • Will be automatically scheduled on Anime Release calendar once broadcast time is announced.`)
          } else {
            const actionVerb = calendarResult.isUpdated ? 'Updated existing schedule on' : 'Scheduled on'
            descLines.push(`📅 **Google Calendar:** ${actionVerb} Anime Release calendar\n   • **Platform:** ${calendarResult.platform}\n   • **Schedule:** ${calendarResult.simulcast}\n   • **Run:** ${calendarResult.recurrence}`)
          }
        }

        embed.setDescription(descLines.join('\n\n'))
        embed.setFooter({ text: `Added by ${interaction.user.username} • View list at ${malClient.getPublicUrl()}` })

        await interaction.editReply({ embeds: [embed] })
      } catch (err) {
        await interaction.editReply(`❌ Error adding anime: ${err.message}`)
      }
      return
    }

    if (subcommand === 'remove') {
      const rawTitle = interaction.options.getString('title', true).trim()
      const removeCalendar = interaction.options.getBoolean('remove_calendar') !== false

      try {
        let malRemoved = false
        let malWarning = null

        if (malClient.isAuthenticated()) {
          try {
            await malClient.removeAnime(rawTitle)
            malRemoved = true
          } catch (mErr) {
            malWarning = mErr.message
          }
        }

        let calRemoved = false
        if (removeCalendar) {
          try {
            const calRes = await ActionExecutor.executeAction('google_calendar', {
              operation: 'delete_event',
              query: rawTitle
            }, { isOwner: true, isInteractive: true, interaction })
            calRemoved = calRes.success
          } catch (_) {}
        }

        const embed = new EmbedBuilder()
          .setTitle(`🗑️ Removed: ${rawTitle}`)
          .setColor(0xe74c3c)
          .setDescription(
            (malRemoved ? '✅ Removed from MyAnimeList watchlist.\n' : (malWarning ? `⚠️ MAL: ${malWarning}\n` : '')) +
            (calRemoved ? '✅ Removed recurring event from Google Calendar.' : '⚠️ Calendar event not found or already removed.')
          )
          .setFooter({ text: `Removed by ${interaction.user.username}` })

        await interaction.editReply({ embeds: [embed] })
      } catch (err) {
        await interaction.editReply(`❌ Error removing anime: ${err.message}`)
      }
      return
    }

    if (subcommand === 'list') {
      const filter = interaction.options.getString('filter', false) ||
                     interaction.options.getString('status', false) ||
                     'airing'
      try {
        let malStatus = 'watching'
        if (filter === 'completed') malStatus = 'completed'
        else if (filter === 'plan_to_watch') malStatus = 'plan_to_watch'

        const fullList = await malClient.getUserList(malStatus)
        if (!fullList || fullList.length === 0) {
          await interaction.editReply(`No anime found in "${malStatus}" list on MyAnimeList.`)
          return
        }

        let displayedList = fullList
        let titleHeader = 'Currently Airing'
        if (filter === 'airing') {
          displayedList = fullList.filter(item =>
            item.anime_airing_status === 1 ||
            item.airing_status === 'currently_airing'
          )
          titleHeader = 'Currently Airing'
        } else if (filter === 'upcoming') {
          displayedList = fullList.filter(item =>
            item.anime_airing_status === 3 ||
            item.airing_status === 'not_yet_aired'
          )
          titleHeader = 'Upcoming'
        } else if (filter === 'all') {
          displayedList = fullList
          titleHeader = 'All Tracked'
        } else if (filter === 'completed') {
          titleHeader = 'Completed'
        } else if (filter === 'plan_to_watch') {
          titleHeader = 'Plan to Watch'
        }

        const publicUrl = malClient.getPublicUrl()
        const upcomingCount = fullList.filter(item => item.anime_airing_status === 3 || item.airing_status === 'not_yet_aired').length
        const footerNote = filter === 'airing' && upcomingCount > 0
          ? `Showing: ${displayedList.length} airing (${upcomingCount} upcoming • /animelist list filter:upcoming) • Total on MAL: ${fullList.length}`
          : `Showing: ${displayedList.length} • Total on MAL: ${fullList.length}`

        const embed = new EmbedBuilder()
          .setTitle(`📺 Anime Watchlist (${titleHeader.toUpperCase()})`)
          .setURL(publicUrl)
          .setColor(0x3498db)
          .setFooter({ text: `${footerNote} • [View on MyAnimeList](${publicUrl})` })

        if (displayedList.length === 0) {
          embed.setDescription(`No series currently classified as **${titleHeader}** on MyAnimeList.\n\n💡 Use \`/animelist list filter:all\` to view all ${fullList.length} tracked series, or manage your list on [MyAnimeList](${publicUrl}).`)
        } else {
          const animeSync = require('../util/actions/anime_sync')
          const topSlice = displayedList.slice(0, 25)
          const itemPromises = topSlice.map(async (item, idx) => {
            const rawTitle = item.anime_title || item.title || 'Untitled'
            const malId = item.anime_id || item.id
            const totalEps = item.anime_num_episodes || item.episodes || '?'

            let displayTitle = item.english_title || rawTitle
            let progressStr = `(${totalEps} eps)`
            try {
              const details = await animeSync.getAnimeDetails(rawTitle, malId)
              if (details?.title?.english) {
                displayTitle = details.title.english
              }
              const nextEp = details?.nextAiringEpisode?.episode
              const canonicalTotal = details?.episodes || totalEps

              if (nextEp) {
                const aired = nextEp - 1
                progressStr = `(Aired: ${aired}/${canonicalTotal} eps • Next: Ep ${nextEp})`
              } else if (item.airing_status === 'currently_airing' || item.anime_airing_status === 1) {
                progressStr = `(Airing • ${canonicalTotal} eps)`
              } else if (item.airing_status === 'not_yet_aired' || item.anime_airing_status === 3) {
                progressStr = `(Upcoming • ${canonicalTotal} eps)`
              } else if (item.airing_status === 'finished_airing' || item.anime_airing_status === 2) {
                progressStr = `(${canonicalTotal}/${canonicalTotal} eps aired)`
              }
            } catch (_) {}

            return `**${idx + 1}.** [**${displayTitle}**](https://myanimelist.net/anime/${malId}) ${progressStr}`
          })

          const topItems = await Promise.all(itemPromises)
          embed.setDescription(topItems.join('\n') + (displayedList.length > 25 ? `\n\n*... and ${displayedList.length - 25} more on [MyAnimeList](${publicUrl})*` : ''))
        }

        await interaction.editReply({ embeds: [embed] })
      } catch (err) {
        await interaction.editReply(`❌ Failed to retrieve anime list: ${err.message}`)
      }
      return
    }

    if (subcommand === 'sync') {
      try {
        const syncRes = await ActionExecutor.executeAction('anime_sync', {
          operation: 'sync_watchlist',
          structured: true,
          dry_run: false
        }, { isOwner: true, isInteractive: true, interaction })

        if (!syncRes.success) {
          await interaction.editReply(`❌ Sync failed: ${syncRes.error}`)
          return
        }

        const data = syncRes.output
        if (typeof data === 'string') {
          await interaction.editReply(data)
          return
        }

        const publicUrl = malClient.getPublicUrl()
        const hasAdditions = (data.addedToCalendar?.length || 0) > 0
        const hasShifts = (data.scheduleShifted?.length || 0) > 0
        const hasEnded = (data.endedTruncated?.length || 0) > 0
        const hasErrors = (data.errors?.length || 0) > 0

        const embed = new EmbedBuilder()
          .setTitle('🎌 Watchlist & Google Calendar Sync')
          .setURL(publicUrl)
          .setTimestamp()

        if (hasErrors) {
          embed.setColor(0xe74c3c) // Red
        } else if (hasAdditions || hasShifts) {
          embed.setColor(0x2ecc71) // Green
        } else {
          embed.setColor(0x3498db) // Blue
        }

        const fields = []

        if (hasAdditions) {
          fields.push({
            name: `✨ Added to Calendar (${data.addedToCalendar.length})`,
            value: data.addedToCalendar.join('\n').substring(0, 1024),
            inline: false
          })
        }

        if (hasShifts) {
          fields.push({
            name: `🔄 Schedule Shifts (${data.scheduleShifted.length})`,
            value: data.scheduleShifted.join('\n').substring(0, 1024),
            inline: false
          })
        }

        if (hasEnded) {
          fields.push({
            name: `🛑 Ended Series Cleared (${data.endedTruncated.length})`,
            value: data.endedTruncated.map(t => `- 🛑 **${t}**: Future events cleared (history preserved)`).join('\n').substring(0, 1024),
            inline: false
          })
        }

        if (data.pendingBroadcast?.length > 0) {
          fields.push({
            name: `⏳ Pending Broadcast Announcement (${data.pendingBroadcast.length})`,
            value: data.pendingBroadcast.map(p => `- ⏳ **${p.title}**: ${p.timeDesc} (schedule unconfirmed)`).join('\n').substring(0, 1024),
            inline: false
          })
        }

        if (data.alreadyPresent?.length > 0) {
          const count = data.alreadyPresent.length
          const airingCount = data.airingCount !== undefined
            ? data.airingCount
            : data.alreadyPresent.filter(p => !p.isUpcoming).length
          const upcomingCount = data.upcomingCount !== undefined
            ? data.upcomingCount
            : data.alreadyPresent.filter(p => p.isUpcoming).length

          const breakdownStr = upcomingCount > 0
            ? `(**${airingCount}** currently airing, **${upcomingCount}** upcoming)`
            : 'currently airing'

          const titles = data.alreadyPresent.map(p => typeof p === 'string' ? p : p.title)
          let valueText
          if (count > 10) {
            valueText = `All **${count}** active series ${breakdownStr} are scheduled and up to date on **${data.calendarTarget}**.\n\n` +
              titles.slice(0, 10).map((t, idx) => `**${idx + 1}.** ${t}`).join('\n') +
              `\n*... and ${count - 10} more on [MyAnimeList](${publicUrl})*`
          } else {
            valueText = `All **${count}** active series ${breakdownStr} are scheduled on **${data.calendarTarget}**:\n\n` +
              titles.map((t, idx) => `**${idx + 1}.** ${t}`).join('\n')
          }

          fields.push({
            name: `✅ Up to Date on Calendar (${count})`,
            value: valueText.substring(0, 1024),
            inline: false
          })
        }

        if (hasErrors) {
          fields.push({
            name: `⚠️ Issues / Errors (${data.errors.length})`,
            value: data.errors.map(e => `- ❌ **${e.title}**: ${e.error}`).join('\n').substring(0, 1024),
            inline: false
          })
        }

        if (fields.length > 0) {
          embed.addFields(fields)
        } else {
          embed.setDescription('Sync completed. No active series required updates.')
        }

        embed.setFooter({
          text: `Account: ${data.username} • Target Calendar: ${data.calendarTarget}`
        })

        await interaction.editReply({ embeds: [embed] })
      } catch (err) {
        await interaction.editReply(`❌ Sync failed: ${err.message}`)
      }
      return
    }

    if (subcommand === 'seed') {
      try {
        const googleCalendar = require('../util/actions/google_calendar')
        const token = await googleCalendar.getAccessToken()
        const calendar = await googleCalendar.resolveCalendar('Anime Release')
        const calRes = await axios.get(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?maxResults=250`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const rawTitles = [...new Set((calRes.data?.items || []).map(e => e.summary).filter(Boolean))]
        if (rawTitles.length === 0) {
          await interaction.editReply('No events found on Anime Release calendar.')
          return
        }

        let addedCount = 0
        const failures = []
        for (const title of rawTitles) {
          try {
            await malClient.addAnime(title, { status: 'watching' })
            addedCount++
          } catch (err) {
            failures.push(title)
          }
        }

        const publicUrl = malClient.getPublicUrl()
        const embed = new EmbedBuilder()
          .setTitle('🌱 Watchlist Seeded from Calendar')
          .setColor(0x2ecc71)
          .setDescription(`Successfully added **${addedCount}** series from Google Calendar to [MyAnimeList](${publicUrl})!${failures.length > 0 ? `\n\n⚠️ Could not resolve on MAL: ${failures.slice(0, 5).join(', ')}` : ''}`)
          .setURL(publicUrl)

        await interaction.editReply({ embeds: [embed] })
      } catch (err) {
        await interaction.editReply(`❌ Failed to seed watchlist: ${err.message}`)
      }
    }
  }
}
