const { MessageFlags } = require('discord.js');
const logger = require('../logger');
const { extractUrls, shouldSkipUrl, summarizeUrl, splitMessage } = require('../util/summarize');

const SUMMARY_CHANNELS = [
    // process.env.LINK_SUMMARY_CHANNEL || '898583333716525107',  // prod
    process.env.TEST_CHANNEL || '558430903072718868'            // dev / test (always active)
];

function linkSummarize(bot) {
    bot.on('messageCreate', async message => {
        if (message.author.bot) return;
        if (!SUMMARY_CHANNELS.includes(message.channelId)) return;

        // If the bot is mentioned, let the chat command handle the link instead of the auto-summarizer
        if (message.mentions.has(bot.user)) return;

        const urls = extractUrls(message.content);
        if (urls.length === 0) return;

        const url = urls[0];
        if (shouldSkipUrl(url)) return;

        logger.info(`Link summary triggered for: ${url}`);

        try {
            message.channel.sendTyping();

            const summary = await summarizeUrl(url);
            if (summary) {
                const chunks = splitMessage(`📰 **Summary:**\n${summary}`);
                for (let i = 0; i < chunks.length; i++) {
                    if (i === 0) {
                        await message.reply({
                            content: chunks[i],
                            allowedMentions: { repliedUser: false },
                            flags: [MessageFlags.SuppressEmbeds]
                        });
                    } else {
                        await message.channel.send({
                            content: chunks[i],
                            flags: [MessageFlags.SuppressEmbeds]
                        });
                    }
                }
            }
        } catch (err) {
            logger.error(`Link summary error: ${err.message}`);
        }
    });
}

module.exports = linkSummarize;
