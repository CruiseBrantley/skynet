const { SlashCommandBuilder, EmbedBuilder } = require('discord.js')
const logger = require('../logger')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restart')
    .setDescription('Gracefully restarts the Skynet service (Bot Owner Only)'),
  async execute (interaction, database) {
    const ownerId = process.env.OWNER_ID
    if (!ownerId || interaction.user.id !== ownerId) {
      return await interaction.reply({
        content: '⛔ Only the bot owner can restart the Skynet service.',
        ephemeral: true
      })
    }

    const embed = new EmbedBuilder()
      .setTitle('🔄 Restarting Skynet')
      .setColor(0x00A2FF)
      .setDescription('Tearing down active sessions and initiating graceful service reboot. macOS LaunchAgent will respawn Skynet in ~2 seconds.')
      .setTimestamp()

    await interaction.reply({ embeds: [embed] })

    logger.info(`RestartCommand: Initiated graceful restart by owner ${interaction.user.tag || interaction.user.username} (${interaction.user.id})`)

    setTimeout(async () => {
      try {
        if (interaction.client?.destroy) {
          await interaction.client.destroy()
        }
      } catch (err) {
        logger.warn(`RestartCommand: Error destroying client: ${err.message}`)
      } finally {
        process.exit(0)
      }
    }, 750)
  }
}
