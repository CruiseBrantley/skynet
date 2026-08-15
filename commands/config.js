const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js')
const { getGuildConfig, setFeatureEnabled, SUPPORTED_FEATURES } = require('../util/config_manager')
const logger = require('../logger')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Manage Skynet bot configuration and AI feature toggles')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('View active AI feature toggles for this server')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('toggle')
        .setDescription('Enable or disable a specific AI feature')
        .addStringOption(option =>
          option
            .setName('feature')
            .setDescription('The AI feature to toggle')
            .setRequired(true)
            .addChoices(
              { name: 'Channel Digest (/tldr)', value: 'tldr' },
              { name: 'Deep Web Research (/research)', value: 'research' },
              { name: 'Smart Discussion Polls (/smart-poll)', value: 'smart_poll' }
            )
        )
        .addBooleanOption(option =>
          option
            .setName('enabled')
            .setDescription('Set feature state (true = enabled, false = disabled)')
            .setRequired(true)
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
      const config = getGuildConfig(guildId)
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Skynet AI Feature Configuration')
        .setColor(0x0099ff)
        .setDescription(guildId ? 'Current AI feature states for this server:' : 'AI features in Direct Messages are always active.')
        .setTimestamp()

      for (const [key, item] of Object.entries(config)) {
        const icon = item.enabled ? '✅ Enabled' : '❌ Disabled'
        embed.addFields({ name: item.name, value: `${icon} (\`key: ${key}\`)`, inline: false })
      }

      return interaction.reply({ embeds: [embed], ephemeral: true })
    }

    if (subcommand === 'toggle') {
      if (!guildId) {
        return interaction.reply({ content: 'Feature toggles are server-specific and cannot be modified in DMs.', ephemeral: true })
      }

      const feature = interaction.options.getString('feature')
      const enabled = interaction.options.getBoolean('enabled')

      try {
        setFeatureEnabled(feature, enabled, guildId)
        const featureMeta = SUPPORTED_FEATURES[feature]
        const stateText = enabled ? '✅ **Enabled**' : '❌ **Disabled**'

        logger.info(`config: User ${interaction.user.username} set ${feature} to ${enabled} in guild ${guildId}`)
        return interaction.reply({
          content: `${stateText} feature **${featureMeta.name}** for this server.`,
          ephemeral: true
        })
      } catch (err) {
        logger.error(`config error: ${err.message}`)
        return interaction.reply({ content: `Failed to update configuration: ${err.message}`, ephemeral: true })
      }
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
