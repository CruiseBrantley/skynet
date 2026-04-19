const logger = require('../../logger');

module.exports = {
    name: 'add_reaction',
    description: 'Adds an emoji reaction to a specific message in the current channel',
    schema: {
        messageId: 'string — the ID of the message to react to',
        emoji: 'string — the emoji character or name to add (e.g. 👍, ✅, 🔥)'
    },
    execute: async (bot, channel, params) => {
        const { messageId, emoji } = params;
        if (!messageId || !emoji) return;

        try {
            const message = await channel.messages.fetch(messageId);
            if (message) {
                await message.react(emoji);
                logger.info(`ActionExecutor: Added reaction ${emoji} to message ${messageId}`);
            }
        } catch (err) {
            logger.error(`ActionExecutor: Failed to add reaction to ${messageId}: ${err.message}`);
            throw err;
        }
    }
};
