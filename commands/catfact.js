const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const logger = require('../logger');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('catfact')
		.setDescription('Get a random cat fact'),
	async execute(interaction) {
        await interaction.deferReply();
        axios
          .get(process.env.CATFACT_GET)
          .then(async response => {
            await interaction.editReply(response.data.fact);
          })
          .catch(async error => {
            logger.info(error);
            await interaction.editReply('Could not retrieve a cat fact at this time.');
          });
	},
};
