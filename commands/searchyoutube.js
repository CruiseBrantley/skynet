const { SlashCommandBuilder } = require('discord.js');
const youtubeSearch = require('youtube-search');
const logger = require('../logger');
const decode = require('unescape');

function colorFunc (index) {
  if (index === 0) return 15794179
  if (index === 1) return 16748032
  if (index === 2) return 16773120
}

function footerFunc (index) {
  if (index === 0) return '/youtube query:red'
  if (index === 1) return '/youtube query:orange'
  if (index === 2) return '/youtube query:yellow'
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('searchyoutube')
		.setDescription('Searches YouTube and returns the top 3 results')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('The search query')
                .setRequired(true)),
	async execute(interaction) {
        const query = interaction.options.getString('query');
        await interaction.deferReply();

        const opts = {
            maxResults: 3,
            key: process.env.YOUTUBE_KEY,
            type: 'video'
        };

        youtubeSearch(query, opts, async (err, results) => {
            if (err) {
                logger.info('youtubeSearch error: ', err);
                await interaction.editReply('There was an error searching YouTube.');
                return;
            }
            
            global.lastSearch = results; // Set global lastSearch for youtube command
            
            const embeds = results.map((result, index) => {
                return {
                    author: {
                        name: decode(result.channelTitle)
                    },
                    title: decode(result.title),
                    description: decode(result.description),
                    url: result.link,
                    color: colorFunc(index),
                    timestamp: new Date(result.publishedAt).toISOString(),
                    thumbnail: {
                        url: result.thumbnails.default.url
                    },
                    footer: {
                        text: footerFunc(index)
                    }
                };
            });
            
            await interaction.editReply({ content: `Top 3 results for **${query}**:`, embeds: embeds });
        });
	},
};
