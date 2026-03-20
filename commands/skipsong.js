const { SlashCommandBuilder } = require('discord.js');
const playVideo = require('../util/playVideo');
const { getVoiceConnection } = require('@discordjs/voice');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('skipsong')
		.setDescription('Skips the current song if a playlist is playing'),
	async execute(interaction) {
        // Needs a globally stored playlist mechanism, replicating the old behavior loosely
        if (global.globalPlaylist && global.globalPlaylist.length) {
            const connection = getVoiceConnection(interaction.guildId);
            if (!connection) {
                await interaction.reply({ content: 'I am not connected to a voice channel.', ephemeral: true });
                return;
            }
            
            const nextVideoUrl = global.globalPlaylist.shift().shortUrl;
            await playVideo(nextVideoUrl, interaction.guildId, 5);
            await interaction.reply(`Skipped song. Next playing: ${nextVideoUrl}`);
        } else {
            await interaction.reply({ content: 'No playlist is currently active or queue is empty.', ephemeral: true });
        }
	},
};
