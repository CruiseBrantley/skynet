const logger = require('../../logger');

module.exports = {
    name: 'remove_reaction',
    description: 'Removes its own emoji reaction from a specific message',
    schema: {
        messageId: 'string — the ID of the message',
        emoji: 'string — the emoji character or name to remove'
    },
    execute: async (bot, channel, params) => {
        const { messageId, emoji } = params;
        if (!messageId || !emoji) return;

        try {
            const message = await channel.messages.fetch(messageId);
            if (message) {
                const reaction = message.reactions.cache.find(r => r.emoji.name === emoji || r.emoji.id === emoji);
                if (reaction) {
                    await reaction.users.remove(bot.user.id);
                    logger.info(`ActionExecutor: Removed reaction ${emoji} from message ${messageId}`);
                }
            }
        } catch (err) {
            logger.error(`ActionExecutor: Failed to remove reaction from ${messageId}: ${err.message}`);
            throw err;
        }
    }
};
