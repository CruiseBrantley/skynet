const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const logger = require('../logger');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('listnotes')
		.setDescription('List all current notes in the Skynet notes database'),
	async execute(interaction) {
        await interaction.deferReply();

        axios
        .get(process.env.NOTESPOST, {
            headers: {
            username: process.env.NOTESUSER,
            password: process.env.NOTESPASS
            }
        })
        .then(async response => {
            if (!response.data || !response.data.notes || response.data.notes.length === 0) {
            await interaction.editReply(
                'There aren\'t currently any notes, you could change this with `/note title:"New Title" text:"The new note."`'
            );
            return;
            }
            let newMessage = '```Current Notes:';
            for (const note of response.data.notes) {
            note.title === 'Untitled'
                ? (newMessage += '\n' + note.text)
                : (newMessage += '\n' + note.title + ': ' + note.text);
            }
            await interaction.editReply(newMessage + '```');
        })
        .catch(async error => {
            logger.info(error);
            await interaction.editReply('There was an error fetching the notes.');
        });
	},
};
