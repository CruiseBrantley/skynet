const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js')
const { getGuildProactiveConfig, setProactiveSetting } = require('../util/config_manager')
const logger = require('../logger')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure autonomous proactive AI behavior and channel settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('View active proactive AI settings and channel whitelists')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('proactive')
        .setDescription('Configure autonomous chat presence and reactions')
        .addBooleanOption(option =>
          option
            .setName('presence')
            .setDescription('Enable or disable autonomous chat interjections')
            .setRequired(true)
        )
        .addBooleanOption(option =>
          option
            .setName('reactions')
            .setDescription('Enable or disable automatic GIF/emoji reactions')
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('channels')
            .setDescription('Allowed channels (e.g. "all", or comma-separated "#general, #gaming")')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('patch-notes')
        .setDescription('Configure proactive game patch notes digests')
        .addBooleanOption(option =>
          option
            .setName('enabled')
            .setDescription('Enable or disable proactive game patch digests')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('channels')
            .setDescription('Target channels for patch notes (e.g. "#game-news, #patch-notes")')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('gif')
        .setDescription('Configure autonomous GIF reaction theme')
        .addStringOption(option =>
          option
            .setName('theme')
            .setDescription('The GIF search theme/category')
            .setRequired(true)
            .addChoices(
              { name: 'Anime / Reaction', value: 'anime' },
              { name: 'Funny / Memes', value: 'funny' },
              { name: 'Gaming', value: 'gaming' },
              { name: 'Disabled', value: 'disabled' }
            )
        )
        .addStringOption(option =>
          option
            .setName('server_id')
            .setDescription('Override Guild ID (Owner only)')
            .setRequired(false)
        )
    ),

  async execute (interaction, database) {
    const subcommand = interaction.options.getSubcommand()
    const isOwner = process.env.OWNER_ID && interaction.user.id === process.env.OWNER_ID
    const isAdmin = interaction.member?.permissions?.has ? interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) || interaction.member.permissions.has(PermissionFlagsBits.Administrator) : false

    if (!isAdmin && !isOwner) {
      return interaction.reply({
        content: 'You do not have permission to manage bot configuration.',
        ephemeral: true
      })
    }

    const guildId = interaction.guildId

    if (subcommand === 'status') {
      const config = getGuildProactiveConfig(guildId)
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Skynet Proactive AI Configuration')
        .setColor(0x0099ff)
        .setDescription(guildId ? 'Active autonomous background settings for this server:' : 'Autonomous settings in DMs are using defaults.')
        .setTimestamp()

      for (const [key, item] of Object.entries(config)) {
        let valDisplay = String(item.value)
        if (typeof item.value === 'boolean') {
          valDisplay = item.value ? '✅ Enabled' : '❌ Disabled'
        } else if (!valDisplay.trim()) {
          valDisplay = '*None configured*'
        }
        embed.addFields({ name: item.name, value: `${valDisplay} (\`${key}\`)`, inline: false })
      }

      return interaction.reply({ embeds: [embed], ephemeral: true })
    }

    if (subcommand === 'proactive') {
      if (!guildId) {
        return interaction.reply({ content: 'Proactive settings are server-specific.', ephemeral: true })
      }

      const presence = interaction.options.getBoolean('presence')
      const reactions = interaction.options.getBoolean('reactions')
      const channels = interaction.options.getString('channels')

      setProactiveSetting('proactive_presence', presence, guildId)
      if (reactions !== null && reactions !== undefined) {
        setProactiveSetting('proactive_reactions', reactions, guildId)
      }
      if (channels !== null && channels !== undefined) {
        setProactiveSetting('proactive_channels', channels, guildId)
      }

      const chanText = channels ? `\n- Channels: \`${channels}\`` : ''
      const reactText = reactions !== null ? `\n- Reactions: ${reactions ? '✅ Enabled' : '❌ Disabled'}` : ''

      logger.info(`config: User ${interaction.user.username} set proactive presence to ${presence} in guild ${guildId}`)
      return interaction.reply({
        content: `⚙️ Updated proactive chat presence for this server:\n- Interjections: ${presence ? '✅ Enabled' : '❌ Disabled'}${reactText}${chanText}`,
        ephemeral: true
      })
    }

    if (subcommand === 'patch-notes') {
      if (!guildId) {
        return interaction.reply({ content: 'Patch notes settings are server-specific.', ephemeral: true })
      }

      const enabled = interaction.options.getBoolean('enabled')
      const channels = interaction.options.getString('channels')

      setProactiveSetting('game_patch_notes', enabled, guildId)
      if (channels !== null && channels !== undefined) {
        setProactiveSetting('patch_channels', channels, guildId)
      }

      const chanText = channels ? `\n- Target Channels: \`${channels}\`` : ''

      logger.info(`config: User ${interaction.user.username} set game_patch_notes to ${enabled} in guild ${guildId}`)
      return interaction.reply({
        content: `⚙️ Updated proactive game patch notes for this server:\n- Status: ${enabled ? '✅ Enabled' : '❌ Disabled'}${chanText}`,
        ephemeral: true
      })
    }

    if (subcommand === 'gif') {
      const theme = interaction.options.getString('theme')
      const serverIdOverride = interaction.options.getString('server_id')
      const targetGuildId = (isOwner && serverIdOverride) ? serverIdOverride : guildId

      if (!targetGuildId) {
        return interaction.reply({ content: 'Target guild ID could not be determined.', ephemeral: true })
      }

      if (database && typeof database.ref === 'function') {
        await database.ref(`guild_settings/${targetGuildId}`).update({ gif_theme: theme })
      }

      const embed = new EmbedBuilder()
        .setTitle('⚙️ GIF Configuration Updated')
        .setColor(0x00ae86)
        .setDescription(`Autonomous GIF theme set to **${theme}** for server \`${targetGuildId}\`.`)
        .setTimestamp()

      return interaction.reply({ embeds: [embed] })
    }
  }
}
