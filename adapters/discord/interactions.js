const logger = require('../../logger')
const { musicManager } = require('./voice')
const discordSelfHealing = require('./self_healing')

/**
 * Routes Discord interaction components (buttons, select menus, modals, autocomplete).
 * @param {import('discord.js').Interaction} interaction
 * @param {object} core - SkynetCore instance.
 */
async function handleInteractionComponent (interaction, core) {
  // 1. Autocomplete
  if (interaction.isAutocomplete?.()) {
    const command = interaction.client.commands?.get?.(interaction.commandName)
    if (command && typeof command.autocomplete === 'function') {
      try {
        await command.autocomplete(interaction)
      } catch (error) {
        logger.error(`Autocomplete error: ${error.message}`)
      }
    }
    return true
  }

  // 2. Buttons
  if (interaction.isButton?.()) {
    // A. Server Buttons
    if (interaction.customId.startsWith('server_')) {
      const command = interaction.client.commands?.get?.('server')
      if (command && typeof command.handleButton === 'function') {
        try {
          await command.handleButton(interaction)
        } catch (error) {
          logger.error(`Server button error: ${error.stack || error.message}`)
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Server interaction failed.', ephemeral: true }).catch(() => {})
          }
        }
      }
      return true
    }

    // B. Music Player Buttons
    if (interaction.customId.startsWith('music_')) {
      try {
        await musicManager.handleInteraction(interaction)
      } catch (error) {
        logger.error(`Music button error: ${error.stack || error.message}`)
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Music interaction failed.', ephemeral: true }).catch(() => {})
        }
      }
      return true
    }

    // C. Self-Healing Code Repair Buttons
    if (interaction.customId.startsWith('repair_')) {
      return await discordSelfHealing.handleButton(interaction)
    }

    // D. Dynamic Command Component Dispatch (Buttons, e.g. soundboard_*)
    const [cmdPrefix] = (interaction.customId || '').split(/[_:]/)
    const dynamicCommand = interaction.client?.commands?.get ? interaction.client.commands.get(cmdPrefix) : null
    const handler = dynamicCommand && (
      dynamicCommand.handleButton ||
      dynamicCommand.buttonHandler ||
      dynamicCommand.executeButton ||
      dynamicCommand.handleInteraction
    )

    if (typeof handler === 'function') {
      try {
        await handler(interaction, core?.database)
      } catch (error) {
        logger.error(`Dynamic button error for "${cmdPrefix}": ${error.stack || error.message}`)
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Interaction failed.', ephemeral: true }).catch(() => {})
        }
      }
      return true
    }
  }

  // 3. Select Menus & Modals
  if (interaction.isStringSelectMenu?.() || interaction.isUserSelectMenu?.() || interaction.isRoleSelectMenu?.() || interaction.isChannelSelectMenu?.() || interaction.isModalSubmit?.()) {
    const [cmdPrefix] = (interaction.customId || '').split(/[_:]/)
    const dynamicCommand = interaction.client?.commands?.get ? interaction.client.commands.get(cmdPrefix) : null
    const handler = dynamicCommand && (
      dynamicCommand.handleSelectMenu ||
      dynamicCommand.handleModal ||
      dynamicCommand.handleInteraction
    )

    if (typeof handler === 'function') {
      try {
        await handler(interaction, core?.database)
      } catch (error) {
        logger.error(`Dynamic component error for "${cmdPrefix}": ${error.stack || error.message}`)
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Interaction failed.', ephemeral: true }).catch(() => {})
        }
      }
      return true
    }
  }

  return false
}

module.exports = {
  handleInteractionComponent
}
