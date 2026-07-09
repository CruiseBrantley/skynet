const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js')
const logger = require('../logger')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Manage Skynet settings for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(true) // Allow in DMs for owner
    .addSubcommand(sub =>
      sub.setName('agent')
        .setDescription('Configure proactive agent permissions')
        .addBooleanOption(opt =>
          opt.setName('text')
            .setDescription('Allow Skynet to send proactive text suggestions')
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt.setName('emoji')
            .setDescription('Allow Skynet to proactively react with emojis')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('server_id')
            .setDescription('Target Server ID (Owner Only)')
            .setRequired(false)
        )
    ),

  async execute (interaction, database) {
    if (!database) return interaction.reply({ content: 'Database connection is unavailable.', ephemeral: true })

    const sub = interaction.options.getSubcommand()
    const isAdmin = interaction.member?.permissions.has(PermissionFlagsBits.Administrator)
    const isOwner = interaction.user.id === process.env.OWNER_ID

    if (!isAdmin && !isOwner) {
      return interaction.reply({ content: 'You do not have permission to manage bot configuration.', ephemeral: true })
    }

    const targetGuildId = interaction.options.getString('server_id') || interaction.guildId

    if (!targetGuildId) {
      return interaction.reply({ content: 'Please provide a Server ID when using this command in DMs.', ephemeral: true })
    }

    if (sub === 'agent') {
      const text = interaction.options.getBoolean('text')
      const emoji = interaction.options.getBoolean('emoji')

      if (text === null && emoji === null) {
        return interaction.reply({ content: 'Please specify at least one option: `text` or `emoji`.', ephemeral: true })
      }

      const updates = {}
      if (text !== null) {
        updates.proactive_text_enabled = text
      }
      if (emoji !== null) {
        updates.proactive_emoji_enabled = emoji
      }

      const ref = database.ref(`guild_settings/${targetGuildId}`)

      try {
        await ref.update(updates)

        // Fetch updated settings to output status correctly
        const snapshot = await ref.once('value')
        const settings = snapshot.val() || {}
        const currentText = settings.proactive_text_enabled !== false
        const currentEmoji = settings.proactive_emoji_enabled !== false

        const embed = new EmbedBuilder()
          .setTitle('Skynet Proactive Agent Configuration Updated')
          .setDescription(`Permissions for server \`${targetGuildId}\` have been updated:`)
          .addFields(
            { name: '💬 Proactive Text Replies', value: currentText ? '✅ **ENABLED**' : '❌ **DISABLED**', inline: true },
            { name: '🎭 Proactive Emoji Reactions', value: currentEmoji ? '✅ **ENABLED**' : '❌ **DISABLED**', inline: true }
          )
          .setColor(0x3498db)
          .setTimestamp()

        return interaction.reply({ embeds: [embed] })
      } catch (err) {
        logger.error(`Failed to update config for ${targetGuildId}: ${err.message}`)
        return interaction.reply({ content: 'Failed to update configuration in the database.', ephemeral: true })
      }
    }
  }
}
