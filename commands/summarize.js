const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const logger = require('../logger');
const { extractUrls, shouldSkipUrl, summarizeUrl, splitMessage } = require('../util/summarize');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('summarize')
        .setDescription('Summarize a web page article or story')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('The URL to summarize')
                .setRequired(true)),
    async execute(interaction) {
        const input = interaction.options.getString('url');
        const urls = extractUrls(input);

        if (urls.length === 0) {
            await interaction.reply({ content: 'No valid URL found. Please provide a link.', ephemeral: true });
            return;
        }

        const url = urls[0];
        if (shouldSkipUrl(url)) {
            await interaction.reply({ content: 'That link type (image, video, etc.) cannot be summarized.', ephemeral: true });
            return;
        }

        await interaction.deferReply();

        try {
            const summary = await summarizeUrl(url);
            if (summary) {
                const chunks = splitMessage(`📰 **Summary:**\n${summary}`);
                for (let i = 0; i < chunks.length; i++) {
                    if (i === 0) {
                        await interaction.editReply({ 
                            content: chunks[i],
                            flags: [MessageFlags.SuppressEmbeds]
                        });
                    } else {
                        await interaction.followUp({ 
                            content: chunks[i],
                            flags: [MessageFlags.SuppressEmbeds]
                        });
                    }
                }
            } else {
                await interaction.editReply('Could not extract enough text from that page to summarize. (The site may require JavaScript or be blocking automated access).');
            }
        } catch (err) {
            logger.error(`Summarize command error: ${err.message}`);
            await interaction.editReply('There was an error summarizing that link.');
        }
    },
};
