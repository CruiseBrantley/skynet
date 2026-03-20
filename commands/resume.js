const { SlashCommandBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('resume')
		.setDescription('Resumes paused audio playback.'),
	async execute(interaction) {
        const connection = getVoiceConnection(interaction.guildId);
        if (connection && connection.state.subscription && connection.state.subscription.player) {
            connection.state.subscription.player.unpause();
            await interaction.reply('Playback resumed.');
        } else {
            await interaction.reply({ content: 'Nothing is currently playing or I am not in a voice channel.', ephemeral: true });
        }
	},
};
