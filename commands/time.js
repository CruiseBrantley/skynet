const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('time')
		.setDescription('Converts a date/time to a Discord timestamp format')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('The date or time to convert. Leave empty for current time.')
                .setRequired(false)),
	async execute(interaction) {
        const query = interaction.options.getString('query');
        const date = query ? new Date(query) : new Date()

        if (isNaN(date.valueOf())) {
            await interaction.reply({ content: 'I have no idea what date that is.', ephemeral: true });
            return;
        }

        let time = Math.floor(date.valueOf() / 1000.0)
        if (query) time -= 3600 // DST adjustment matching original logic

		await interaction.reply(`<t:${time}:R> <t:${time}:F> ||\`<t:${time}>\`||`);
	},
};
