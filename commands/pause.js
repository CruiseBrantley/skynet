const { SlashCommandBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('pause')
		.setDescription('Pauses the current audio playback.'),
	async execute(interaction) {
        const connection = getVoiceConnection(interaction.guildId);
        if (connection && connection.state.subscription && connection.state.subscription.player) {
            connection.state.subscription.player.pause();
            await interaction.reply('Playback paused.');
        } else {
            await interaction.reply({ content: 'Nothing is currently playing or I am not in a voice channel.', ephemeral: true });
        }
	},
};
