const { SlashCommandBuilder } = require('discord.js');

let gameSessionID = 0;

module.exports = {
	data: new SlashCommandBuilder()
		.setName('session')
		.setDescription('Session ID Management')
        .addSubcommand(subcommand =>
            subcommand
                .setName('get')
                .setDescription('Get the current game session ID'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set the current game session ID (Admin only)')
                .addIntegerOption(option => 
                    option.setName('id')
                        .setDescription('The new session ID')
                        .setRequired(true))),
	async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'get') {
            await interaction.reply(`The current Session ID is: ${gameSessionID}`);
        } else if (subcommand === 'set') {
            if (!interaction.member.permissions.has('Administrator')) {
                await interaction.reply({ content: 'You must have admin permissions to set sessionID.', ephemeral: true });
                return;
            }
            gameSessionID = interaction.options.getInteger('id');
            await interaction.reply(`The Session ID has been set to: ${gameSessionID}`);
        }
	},
};
