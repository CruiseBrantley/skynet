const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const logger = require('../logger');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wafflehouse')
		.setDescription('Returns the Waffle House Index (percentage of open stores)'),
	async execute(interaction) {
		await interaction.deferReply();
        try {
            const results = { total: 0, closed: 0 }
            
            const response = await axios.get(
                'https://api.sweetiq.com/store-locator/public/locations/587d236eeb89fb17504336db?categories=&tag=&geo%5B0%5D=-120&geo%5B1%5D=41&perPage=2000&page=1&search=&searchFields%5B0%5D=name&clientIds%5B0%5D=56fd9c824a88871f1d26062a&box%5B0%5D=-135&box%5B1%5D=-50&box%5B2%5D=4.25945681015628&box%5B3%5D=71.17296709014458'
            )
            
            response.data.records.forEach(record => {
                results.total++
                if (!record.isCurrentlyOpen) results.closed++
            })
            
            await interaction.editReply(
                `Current Waffle House Index is ${(
                    ((results.total - results.closed) / results.total) *
                    100
                ).toFixed(2)}%. ${results.closed} of ${
                    results.total
                } Waffle Houses are closed.`
            )
        } catch (err) {
            logger.error('WaffleHouse error:', err);
            await interaction.editReply('Could not retrieve the Waffle House Index.');
        }
	},
};
