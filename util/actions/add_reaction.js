const logger = require('../../logger');

module.exports = {
    name: 'add_reaction',
    description: 'Adds an emoji reaction to a specific message in the current channel',
    schema: {
        messageId: 'string — the ID of the message to react to',
        emoji: 'string — the emoji character or name to add (e.g. 👍, ✅, 🔥)'
    },
    execute: async (bot, channel, params) => {
        let { messageId, emoji } = params;
        if (!emoji) return;

        try {
            let message;
            // Handle placeholders or missing IDs by fetching the last message in the channel
            if (!messageId || !/^\d+$/.test(messageId)) {
                const recent = await channel.messages.fetch({ limit: 1 });
                message = recent.first();
            } else {
                message = await channel.messages.fetch(messageId);
            }

            if (message) {
                await message.react(emoji);
                logger.info(`ActionExecutor: Added reaction ${emoji} to message ${message.id}`);
            } else {
                throw new Error("Could not find a message to react to in this channel.");
            }
        } catch (err) {
            logger.error(`ActionExecutor: Failed to add reaction: ${err.message}`);
            throw err;
        }
    }
};
