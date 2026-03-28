const { SlashCommandBuilder } = require('discord.js');
const moment = require('moment');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('time')
		.setDescription('Returns the current time'),
	async execute(interaction) {
        const currentTime = moment().format('MMMM Do YYYY, h:mm:ss a');
		await interaction.reply({ content: `The current time is: **${currentTime}**` });
	},
};
