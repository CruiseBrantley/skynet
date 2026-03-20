const { SlashCommandBuilder } = require('discord.js');
const publicIp = require('public-ip');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('server')
		.setDescription('Returns the current server IP address for Skynet'),
	async execute(interaction) {
		await interaction.deferReply({ ephemeral: true });
        try {
            const ip = await publicIp.v4();
            await interaction.editReply(`The current server ip address is: ${ip}`);
        } catch (error) {
            await interaction.editReply('There was an error retrieving the server IP address.');
        }
	},
};
