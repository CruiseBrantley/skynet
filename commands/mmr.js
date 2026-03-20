const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const logger = require('../logger');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('mmr')
		.setDescription('Lookup MMR for a League of Legends Summoner (NA)')
        .addStringOption(option => 
            option.setName('summoner')
                .setDescription('The Summoner name to look up')
                .setRequired(true)),
	async execute(interaction) {
        const query = interaction.options.getString('summoner');
        await interaction.deferReply();
        
        axios
        .get('https://na.whatismymmr.com/api/v1/summoner?name=' + encodeURIComponent(query))
        .then(async response => {
          if (response?.data?.ranked?.closestRank) {
            let strippedString = response.data.ranked.summary.replace(/(<br>)/, "\n")
            strippedString = strippedString.replace(/(<([^>]+)>)/gi, "")
            await interaction.editReply(strippedString)
            return
          }
          await interaction.editReply("There's not enough ranked data for this Summoner.")
        })
        .catch(async error => {
          const { response } = error
          if (response?.data?.error?.code) {
            switch(response?.data?.error?.code) {
              case 100: 
                await interaction.editReply('Could not find this Summoner.')
                break
              case 101:
                await interaction.editReply("There's not enough ranked data for this Summoner.")
                break
              case 9001:
                await interaction.editReply("Too many requests.")
                break
            }
            return
          }
          logger.info(error)
          await interaction.editReply("This Summoner doesn't exist or there was an error.")
        })
	},
};
