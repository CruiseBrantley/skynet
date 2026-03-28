const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } = require('discord.js');
const youtubeSearch = require('youtube-search');
const logger = require('../logger');
const decode = require('unescape');
const musicManager = require('../util/MusicManager');

function colorFunc (index) {
  if (index === 0) return 0x57F287; // Success Green
  if (index === 1) return 0x5865F2; // Primary Blue/Blurple
  if (index === 2) return 0xED4245; // Danger Red
  return 0x000000;
}

function footerFunc (index) {
  if (index === 0) return '/youtube query:green';
  if (index === 1) return '/youtube query:blue';
  if (index === 2) return '/youtube query:red';
  return '';
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
                logger.error('YouTube Search API Error: ', err);
                await interaction.editReply('There was an error searching YouTube. Please try again later.');
                return;
            }

            if (!results || results.length === 0) {
                await interaction.editReply(`No results found for **${query}**.`);
                return;
            }
            
            const topResults = Array.isArray(results) ? results.slice(0, 3) : [];
            global.lastSearch = topResults; 
            
            if (topResults.length === 0) {
                await interaction.editReply(`No results found for **${query}**.`);
                return;
            }

            await interaction.editReply(`Top 3 results for **${query}**:`);

            for (let i = 0; i < topResults.length; i++) {
                const result = topResults[i];
                
                const embed = new EmbedBuilder()
                    .setAuthor({ name: decode(result.channelTitle || 'Unknown Channel') })
                    .setTitle(decode(result.title || 'No Title'))
                    .setDescription(decode(result.description || 'No description available.'))
                    .setURL(result.link)
                    .setColor(colorFunc(i))
                    .setTimestamp(result.publishedAt ? new Date(result.publishedAt) : new Date())
                    .setThumbnail(result.thumbnails?.default?.url || null)
                    .setFooter({ text: footerFunc(i) });

                const labels = ['Green', 'Blue', 'Red'];
                const styles = [ButtonStyle.Success, ButtonStyle.Primary, ButtonStyle.Danger];

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`play_${i}_${Date.now()}`) // Unique ID to avoid duplicate collector issues if any
                            .setLabel('Add to Queue')
                            .setStyle(styles[i]),
                    );

                try {
                    const msg = await interaction.followUp({
                        embeds: [embed],
                        components: [row]
                    });

                    const collector = msg.createMessageComponentCollector({
                        componentType: ComponentType.Button,
                        time: 60_000
                    });

                    collector.on('collect', async btnInteraction => {
                        try {
                            await musicManager.enqueue(btnInteraction, result.link);
                            await btnInteraction.reply({ 
                                content: `✅ Added to queue: **${decode(result.title)}**`, 
                                flags: [MessageFlags.SuppressEmbeds] 
                            });
                        } catch (playErr) {
                            logger.error('Search button error: ', playErr);
                            await btnInteraction.reply({ content: `Failed to add to queue: ${playErr.message}`, ephemeral: true });
                        }
                    });

                    collector.on('end', () => {
                        const disabledRow = new ActionRowBuilder()
                            .addComponents(
                                ButtonBuilder.from(row.components[0]).setDisabled(true)
                            );
                        msg.edit({ components: [disabledRow] }).catch(() => {});
                    });
                } catch (followUpErr) {
                    logger.error(`Failed to send followUp for result ${i}: `, followUpErr);
                }
            }
        });
	},
};
