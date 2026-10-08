const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js')
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const getOAuthToken = require('../server/oauth')
const logger = require('../logger')

const configPath = path.join(__dirname, '../config/announcements.json')

function loadConfig () {
  try {
    const data = fs.readFileSync(configPath, 'utf8')
    return JSON.parse(data)
  } catch (err) {
    return { groups: [], socials: {} }
  }
}

function saveConfig (config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

async function getTwitchUser (identifier) {
  const token = await getOAuthToken()
  const isId = /^\d+$/.test(identifier)
  const params = isId ? { id: identifier } : { login: identifier.toLowerCase() }

  const response = await axios.get('https://api.twitch.tv/helix/users', {
    headers: {
      'Client-ID': process.env.TWITCH_CLIENTID,
      Authorization: `Bearer ${token}`
    },
    params
  })

  let user = response.data.data[0]

  // Fallback if a numeric string was actually a username
  if (!user && isId) {
    const fallback = await axios.get('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENTID,
        Authorization: `Bearer ${token}`
      },
      params: { login: identifier.toLowerCase() }
    })
    user = fallback.data.data[0]
  }

  return user
}

async function getStreamStatus (userId) {
  try {
    const token = await getOAuthToken()
    const response = await axios.get('https://api.twitch.tv/helix/streams', {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENTID,
        Authorization: `Bearer ${token}`
      },
      params: { user_id: userId }
    })
    return response.data?.data?.[0] || null
  } catch (err) {
    logger.warn(`Failed checking live status for ${userId}:`, err.message)
    return null
  }
}

function resolveGroupForGuild (config, guildId, groupName, channelId) {
  const guildGroups = config.groups.filter(g => g.guild_id === guildId)
  if (groupName) {
    return guildGroups.find(g => g.name === groupName) || null
  }
  if (channelId) {
    const byChannel = guildGroups.find(g => g.channel_id === channelId)
    if (byChannel) return byChannel
  }
  if (guildGroups.length === 1) {
    return guildGroups[0]
  }
  return null
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('twitch-notify')
    .setDescription('Manage Twitch announcements (Moderators Only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a streamer to announcement notifications')
        .addStringOption(option => option.setName('username').setDescription('Twitch username or ID').setRequired(true))
        .addStringOption(option => option.setName('group').setDescription('Group name (optional)').setAutocomplete(true).setRequired(false))
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Announcement channel (defaults to current channel or group channel)')
            .addChannelTypes(ChannelType.GuildText))
        .addStringOption(option => option.setName('mention').setDescription('Custom mention (e.g. @everyone or a role ID)')))
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a streamer from announcements')
        .addStringOption(option => option.setName('username').setDescription('Twitch username or ID').setAutocomplete(true).setRequired(true))
        .addStringOption(option => option.setName('group').setDescription('Group name (optional)').setAutocomplete(true).setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('social')
        .setDescription('Manage supplemental social links (e.g. youtube) for a streamer')
        .addStringOption(option => option.setName('username').setDescription('Twitch username or ID').setAutocomplete(true).setRequired(true))
        .addStringOption(option => option.setName('platform').setDescription('The platform (e.g. youtube)').setRequired(true))
        .addStringOption(option => option.setName('link').setDescription('The URL to the profile (Omit to remove)')))
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit-group')
        .setDescription('Update the settings for an announcement group')
        .addStringOption(option => option.setName('group').setDescription('Group name (optional)').setAutocomplete(true).setRequired(false))
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('New announcement channel')
            .addChannelTypes(ChannelType.GuildText))
        .addStringOption(option => option.setName('mention').setDescription('New custom mention string')))
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete-group')
        .setDescription('Permanently delete an announcement group from this server')
        .addStringOption(option => option.setName('group').setDescription('Group name (optional)').setAutocomplete(true).setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('sync')
        .setDescription('Manually re-subscribe to all streamers')),

  async autocomplete (interaction) {
    try {
      const config = loadConfig()
      const guildId = interaction.guildId
      const focusedOption = interaction.options.getFocused(true)
      const focusedValue = (focusedOption.value || '').toLowerCase()

      if (focusedOption.name === 'group') {
        const guildGroups = config.groups.filter(g => g.guild_id === guildId)
        const filtered = guildGroups
          .filter(g => g.name.toLowerCase().includes(focusedValue))
          .map(g => ({ name: `${g.name} (${g.streamers?.length || 0} streamers)`, value: g.name }))
          .slice(0, 25)
        return interaction.respond(filtered)
      }

      if (focusedOption.name === 'username') {
        const guildGroups = config.groups.filter(g => g.guild_id === guildId)
        const streamerIds = new Set()
        guildGroups.forEach(g => (g.streamers || []).forEach(id => streamerIds.add(id)))

        // Fetch display names or IDs
        const suggestions = []
        for (const id of streamerIds) {
          suggestions.push({ name: id, value: id })
        }
        const filtered = suggestions
          .filter(s => s.name.toLowerCase().includes(focusedValue))
          .slice(0, 25)
        return interaction.respond(filtered)
      }
    } catch (err) {
      logger.error('Error in twitch-notify autocomplete:', err)
      return interaction.respond([])
    }
  },

  async execute (interaction) {
    const ownerId = process.env.OWNER_ID
    const botId = process.env.CLIENT_ID

    // Discord handles UI visibility via setDefaultMemberPermissions,
    // but we keep the owner/bot check for robustness and manual overrides.
    const isMod = interaction.member && (
      interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) ||
            interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    )
    const isOwner = interaction.user.id === ownerId
    const isBot = interaction.user.id === botId

    if (!isMod && !isOwner && !isBot) {
      return interaction.reply({ content: 'Only server moderators or the bot owner can manage announcements.', ephemeral: true })
    }

    const subcommand = interaction.options.getSubcommand()
    const config = loadConfig()
    const guildId = interaction.guildId

    if (subcommand === 'edit-group') {
      const groupNameInput = interaction.options.getString('group')
      const channel = interaction.options.getChannel('channel')
      const mention = interaction.options.getString('mention')

      const group = resolveGroupForGuild(config, guildId, groupNameInput, interaction.channelId)

      if (!group) {
        if (groupNameInput) {
          return interaction.reply({ content: `Group "${groupNameInput}" not found in this server.`, ephemeral: true })
        }
        return interaction.reply({ content: 'Could not automatically identify group. Please specify the `group` option.', ephemeral: true })
      }

      let response = `Successfully updated settings for group **${group.name}**:`

      if (channel) {
        group.channel_id = channel.id
        response += `\n- Channel: <#${channel.id}>`
      }
      if (mention !== null) {
        group.mention = mention
        response += `\n- Mention: ${mention || '*None*'}`
      }

      if (!channel && mention === null) {
        return interaction.reply({ content: 'Please provide at least one setting to update (channel or mention).', ephemeral: true })
      }

      saveConfig(config)
      if (interaction.client.configSync) {
        interaction.client.configSync.updateRemote(config)
      }

      return interaction.reply({ content: response, ephemeral: true })
    }

    if (subcommand === 'delete-group') {
      const groupNameInput = interaction.options.getString('group')
      const group = resolveGroupForGuild(config, guildId, groupNameInput, interaction.channelId)

      if (!group) {
        if (groupNameInput) {
          return interaction.reply({ content: `Group "${groupNameInput}" not found in this server.`, ephemeral: true })
        }
        return interaction.reply({ content: 'Could not automatically identify group. Please specify the `group` option.', ephemeral: true })
      }

      const deletedStreamers = [...group.streamers]
      const groupIndex = config.groups.findIndex(g => g === group)
      config.groups.splice(groupIndex, 1)
      saveConfig(config)

      if (interaction.client.configSync) {
        interaction.client.configSync.updateRemote(config)
      }

      // Cleanup orphaned webhook subscriptions
      try {
        const { unsubscribeStreamer } = require('../server/server')
        if (typeof unsubscribeStreamer === 'function') {
          for (const sId of deletedStreamers) {
            const isStillUsed = config.groups.some(g => g.streamers.includes(sId))
            if (!isStillUsed) {
              await unsubscribeStreamer(sId)
            }
          }
        }
      } catch (subErr) {
        logger.warn('Failed to unsubscribe deleted streamers:', subErr.message)
      }

      return interaction.reply({ content: `Successfully deleted group **${group.name}** and all its streamer associations.`, ephemeral: true })
    }

    if (subcommand === 'social') {
      await interaction.deferReply()
      try {
        const identifier = interaction.options.getString('username')
        const platform = interaction.options.getString('platform').toLowerCase()
        const link = interaction.options.getString('link')

        const user = await getTwitchUser(identifier)
        if (!user) {
          return interaction.editReply(`Twitch user "${identifier}" not found.`)
        }

        if (!config.socials) config.socials = {}
        if (!config.socials[user.id]) config.socials[user.id] = {}

        if (link) {
          config.socials[user.id][platform] = link
          saveConfig(config)
          if (interaction.client.configSync) {
            interaction.client.configSync.updateRemote(config)
          }
          return interaction.editReply(`Successfully set **${platform}** for **${user.display_name}** to: ${link}`)
        } else {
          if (config.socials[user.id][platform]) {
            delete config.socials[user.id][platform]

            // Cleanup empty objects
            if (Object.keys(config.socials[user.id]).length === 0) {
              delete config.socials[user.id]
            }

            saveConfig(config)
            if (interaction.client.configSync) {
              interaction.client.configSync.updateRemote(config)
            }
            return interaction.editReply(`Successfully removed **${platform}** from **${user.display_name}**.`)
          } else {
            return interaction.editReply(`No **${platform}** link found for **${user.display_name}**.`)
          }
        }
      } catch (err) {
        logger.error('Error managing social link:', err)
        return interaction.editReply('Failed to manage social link. Check logs.')
      }
    }

    if (subcommand === 'sync') {
      await interaction.deferReply()
      try {
        const { subscribeAll } = require('../server/server')
        await subscribeAll()
        return interaction.editReply('Successfully re-subscribed to all Twitch updates.')
      } catch (err) {
        logger.error('Error syncing twitch subscriptions:', err)
        return interaction.editReply('Failed to sync subscriptions. Check logs.')
      }
    }

    const username = interaction.options.getString('username')?.toLowerCase()
    let groupName = interaction.options.getString('group')

    if (subcommand === 'add') {
      if (!username) return interaction.reply({ content: 'Username is required.', ephemeral: true })
      await interaction.deferReply()
      try {
        const channelOption = interaction.options.getChannel('channel')
        const targetChannelId = channelOption ? channelOption.id : interaction.channelId
        const mention = interaction.options.getString('mention')

        const guildGroups = config.groups.filter(g => g.guild_id === guildId)
        let group = null

        if (groupName) {
          group = guildGroups.find(g => g.name === groupName)
        } else if (channelOption) {
          group = guildGroups.find(g => g.channel_id === channelOption.id)
        } else {
          // If no group and no channel specified, check current channel, or fallback to single group if only 1 exists
          group = guildGroups.find(g => g.channel_id === interaction.channelId)
          if (!group && guildGroups.length === 1) {
            group = guildGroups[0]
          }
        }

        if (!group) {
          // Auto-create group
          const targetChannel = channelOption || interaction.channel
          const defaultName = (targetChannel && targetChannel.name) ? targetChannel.name : 'announcements'
          groupName = groupName || defaultName

          // Ensure group name is unique in this guild if auto-generated
          let uniqueName = groupName
          let counter = 1
          while (guildGroups.some(g => g.name === uniqueName)) {
            uniqueName = `${groupName}_${counter++}`
          }
          groupName = uniqueName

          group = {
            name: groupName,
            channel_id: targetChannelId,
            guild_id: guildId,
            streamers: [],
            mention: mention !== null ? mention : '@everyone'
          }
          config.groups.push(group)
        } else {
          groupName = group.name
          if (channelOption) {
            group.channel_id = channelOption.id
          }
          if (mention !== null) {
            group.mention = mention
          }
        }

        const user = await getTwitchUser(username)
        if (!user) {
          return interaction.editReply(`Twitch user "${username}" not found.`)
        }

        if (group.streamers.includes(user.id)) {
          return interaction.editReply(`"${username}" is already in group "${groupName}".`)
        }

        group.streamers.push(user.id)
        saveConfig(config)

        if (interaction.client.configSync) {
          interaction.client.configSync.updateRemote(config)
        }

        // Targeted auto-subscribe with Twitch EventSub
        try {
          const { subscribeStreamer } = require('../server/server')
          if (typeof subscribeStreamer === 'function') {
            await subscribeStreamer(user.id)
          }
        } catch (subErr) {
          logger.warn(`Auto-subscribe failed for ${user.id}:`, subErr.message)
        }

        // Check if user is currently live right now
        const liveStream = await getStreamStatus(user.id)

        const embed = new EmbedBuilder()
          .setTitle(`✅ Added ${user.display_name} to Twitch Watchlist`)
          .setURL(`https://twitch.tv/${user.login}`)
          .setThumbnail(user.profile_image_url)
          .setColor(0x9146FF) // Twitch Purple
          .addFields(
            { name: 'Group', value: `\`${groupName}\``, inline: true },
            { name: 'Channel', value: `<#${group.channel_id}>`, inline: true },
            { name: 'Mention', value: group.mention || '*None*', inline: true }
          )

        if (liveStream) {
          const streamStarted = new Date(liveStream.started_at).toLocaleTimeString()
          embed.addFields({
            name: '🔴 Currently Live!',
            value: `**${liveStream.game_name || 'Streaming'}**: [${liveStream.title}](https://twitch.tv/${user.login})\n*Started at ${streamStarted} with ${liveStream.viewer_count.toLocaleString()} viewers.*`
          })
        }

        await interaction.editReply({ embeds: [embed] })
      } catch (err) {
        logger.error('Error adding twitch user:', err)
        await interaction.editReply('Failed to add Twitch user. Check logs.')
      }
    }

    if (subcommand === 'remove') {
      if (!username) return interaction.reply({ content: 'Username is required.', ephemeral: true })
      if (groupName && !config.groups.some(g => g.name === groupName && g.guild_id === guildId)) {
        return interaction.reply({ content: `Group "${groupName}" not found in this server.`, ephemeral: true })
      }

      await interaction.deferReply()
      try {
        const user = await getTwitchUser(username)
        if (!user) {
          return interaction.editReply(`Twitch user "${username}" not found.`)
        }

        const guildGroups = config.groups.filter(g => g.guild_id === guildId)
        let group = null

        if (groupName) {
          group = guildGroups.find(g => g.name === groupName)
          if (!group) {
            return interaction.editReply(`Group "${groupName}" not found in this server.`)
          }
        } else {
          // Resolve group containing this streamer
          const matchingGroups = guildGroups.filter(g => g.streamers.includes(user.id))
          if (matchingGroups.length === 0) {
            return interaction.editReply(`"${user.display_name}" is not assigned to any announcement groups in this server.`)
          } else if (matchingGroups.length === 1) {
            group = matchingGroups[0]
            groupName = group.name
          } else {
            const groupList = matchingGroups.map(g => `\`${g.name}\` (<#${g.channel_id}>)`).join(', ')
            return interaction.editReply(`"${user.display_name}" is in multiple groups: ${groupList}. Please specify which \`group\` to remove them from.`)
          }
        }

        const index = group.streamers.indexOf(user.id)
        if (index === -1) {
          return interaction.editReply(`"${username}" is not in group "${groupName}".`)
        }

        group.streamers.splice(index, 1)

        saveConfig(config)
        if (interaction.client.configSync) {
          interaction.client.configSync.updateRemote(config)
        }

        // Targeted auto-unsubscribe if no longer present in any group
        const isStillUsed = config.groups.some(g => g.streamers.includes(user.id))
        if (!isStillUsed) {
          try {
            const { unsubscribeStreamer } = require('../server/server')
            if (typeof unsubscribeStreamer === 'function') {
              await unsubscribeStreamer(user.id)
            }
          } catch (unsubErr) {
            logger.warn(`Auto-unsubscribe failed for ${user.id}:`, unsubErr.message)
          }
        }

        await interaction.editReply(`Successfully removed **${user.display_name}** from group **${groupName}**.`)
      } catch (err) {
        logger.error('Error removing twitch user:', err)
        await interaction.editReply('Failed to remove Twitch user. Check logs.')
      }
    }
  }
}
