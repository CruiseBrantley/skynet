const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../util/MusicManager');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('skipsong')
		.setDescription('Skips the current song if a playlist is playing'),
	async execute(interaction) {
        musicManager.skip(interaction.guildId);
        await interaction.reply(`Skipped the current song.`);
    },
};
