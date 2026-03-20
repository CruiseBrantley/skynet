const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('say')
		.setDescription('Make the bot say a message')
        .addStringOption(option => 
            option.setName('message')
                .setDescription('The message to say')
                .setRequired(true)),
	async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            return;
        }

        const sayMessage = interaction.options.getString('message');
        await interaction.reply({ content: sayMessage });
	},
};
