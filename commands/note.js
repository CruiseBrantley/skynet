const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const logger = require('../logger');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('note')
		.setDescription('Add a new note to the notes database')
        .addStringOption(option => 
            option.setName('text')
                .setDescription('The text of the note')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('title')
                .setDescription('The title of the note')
                .setRequired(false)),
	async execute(interaction) {
        let title = interaction.options.getString('title') || 'Untitled';
        let text = interaction.options.getString('text');

        await interaction.deferReply();

        axios
        .post(
            process.env.NOTESPOST,
            { title, text },
            {
            headers: {
                username: process.env.NOTESUSER,
                password: process.env.NOTESPASS
            }
            }
        )
        .then(async response => {
            await interaction.editReply(
            "I've added your note. You can view them with `/listnotes` or online at https://cruise-notes.web.app/ login with `Cruise-bot` `Whatpassword?`"
            )
        })
        .catch(async err => {
            logger.info(err)
            await interaction.editReply('There was an error saving your note.')
        })
	},
};
