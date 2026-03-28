const { SlashCommandBuilder } = require('discord.js');
const chrono = require('chrono-node');
const moment = require('moment');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('timestamp')
		.setDescription('Converts a date/time to a Discord timestamp format')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('The date or time to convert. Leave empty for current time.')
                .setRequired(false)),
	async execute(interaction) {
        const query = interaction.options.getString('query');
        const date = query ? chrono.parseDate(query) : new Date();

        if (!date || isNaN(date.valueOf())) {
            await interaction.reply({ content: 'I have no idea what date that is.', ephemeral: true });
            return;
        }

        let time = Math.floor(date.valueOf() / 1000.0)
        if (query) time -= 3600 // DST adjustment matching original logic

        const relativeStr = moment(date.valueOf() - (query ? 3600000 : 0)).fromNow();

		await interaction.reply(`**${relativeStr}** (<t:${time}:R>)\n<t:${time}:F> ||\`<t:${time}>\`||`);
	},
};
