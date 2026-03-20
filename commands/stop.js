const { SlashCommandBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('stop')
		.setDescription('Stops the current YouTube playback and disconnects the bot.'),
	async execute(interaction) {
        const connection = getVoiceConnection(interaction.guildId);
        if (connection) {
            connection.destroy();
            interaction.client.user.setActivity(process.env.ACTIVITY);
            await interaction.reply('Playback stopped and disconnected.');
        } else {
            await interaction.reply({ content: 'I am not currently in a voice channel!', ephemeral: true });
        }
	},
};
