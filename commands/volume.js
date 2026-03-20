const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('volume')
		.setDescription('Change the global audio volume (0-200)')
        .addIntegerOption(option => 
            option.setName('level')
                .setDescription('Volume level (0-200, default 5)')
                .setRequired(false)),
	async execute(interaction) {
        // Since playVideo.js currently sets volume using inlineVolume without Discord.js v14 properly supporting it via resource.volume, this command might not operate correctly
        await interaction.reply({ content: 'Volume adjustment is not directly supported in the new audio player implementation.', ephemeral: true });
	},
};
