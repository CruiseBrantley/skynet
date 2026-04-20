const { MessageFlags } = require('discord.js');
const logger = require('../logger');
const { extractUrls, shouldSkipUrl, summarizeUrl, splitMessage } = require('../util/summarize');

const firebase = require('../firebase-login');
const processedMessages = new Set();
const CACHE_SIZE = 100;

function linkSummarize(bot) {
    bot.on('messageCreate', async message => {
        if (message.author.bot || !message.guild) return;

        // Skip messages sent more than 5 minutes ago
        if (Date.now() - message.createdAt.getTime() > 5 * 60 * 1000) return;

        // Deduplication Check
        if (processedMessages.has(message.id)) return;
        processedMessages.add(message.id);
        if (processedMessages.size > CACHE_SIZE) {
            const first = processedMessages.values().next().value;
            processedMessages.delete(first);
        }

        // Fetch guild-level settings
        const database = firebase();
        const snapshot = await database.ref(`guild_settings/${message.guildId}/agent_enabled`).once('value');
        if (!snapshot.exists() || snapshot.val() !== true) return;

        // If the bot is mentioned, let the chat command handle the link instead of the auto-summarizer
        if (message.mentions.has(bot.user)) return;

        const urls = extractUrls(message.content);
        if (urls.length === 0) return;

        const url = urls[0];
        if (shouldSkipUrl(url)) return;

        // Selective Check: Ask local LLM if this link is worth an automatic summary
        const { queryLocalOrRemote } = require('../util/ollama');
        const botName = process.env.BOT_NAME || 'Skynet';
        const decision = await queryLocalOrRemote('/api/chat', {
            messages: [
                { role: 'system', content: `You are ${botName}. Decide if this link should be automatically summarized for the channel. Respond only with YES or NO.\nLogic: Respond YES if the link looks like a complex article, news, or technical page where a summary adds value. Respond NO if it's a simple social media post, a common site, or clear from the title.` },
                { role: 'user', content: `Message: "${message.content}"\nURL: ${url}\n\nShould I summarize this?` }
            ],
            options: { temperature: 0, num_predict: 5 }
        }).catch(() => ({ message: { content: 'NO' } }));

        if (!decision?.message?.content?.toUpperCase().includes('YES')) return;

        logger.info(`Link summary triggered (via AI decision) for: ${url}`);

        try {
            message.channel.sendTyping();

            const summary = await summarizeUrl(url, false);
            if (summary) {
                const summarizeCmd = require('../commands/summarize');
                const id = summarizeCmd._cacheUrl(url);
                const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`summarize_expand_${id}`)
                        .setLabel('Expand')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('📖')
                );

                const chunks = splitMessage(`📰 **Summary:**\n${summary}`);
                for (let i = 0; i < chunks.length; i++) {
                    const payload = {
                        content: chunks[i],
                        allowedMentions: { repliedUser: false },
                        flags: [MessageFlags.SuppressEmbeds]
                    };
                    if (i === 0) payload.components = [row];

                    if (i === 0) {
                        await message.reply(payload);
                    } else {
                        await message.channel.send(payload);
                    }
                }
            }
        } catch (err) {
            logger.error(`Link summary error: ${err.message}`);
        }
    });
}

module.exports = linkSummarize;
