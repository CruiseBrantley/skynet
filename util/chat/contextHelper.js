const logger = require('../../logger');

/**
 * Formats a collection of Discord messages into the role-based format Skynet expects.
 * Includes Message IDs to enable the AI to target them with actions like reactions.
 */
function formatMessagesForContext(messages, botId) {
    // Collect from oldest to newest
    const sorted = Array.from(messages.values()).sort((a, b) => a.createdAt - b.createdAt);
    
    return sorted
        .map(m => {
            const role = m.author.id === botId ? 'assistant' : 'user';
            const handle = `@${m.author.username}`;
            const content = m.content.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();
            return { role, content: `[ID: ${m.id}] ${handle}: ${content}` };
        })
        .filter(m => m.content.length > 0);
}

/**
 * Fetches the last N messages from a channel and formats them.
 */
async function fetchAndFormatContext(channel, botId, limit = 20, excludeId = null) {
    try {
        const fetched = await channel.messages.fetch({ limit });
        let filtered = Array.from(fetched.values());
        if (excludeId) {
            filtered = filtered.filter(m => m.id !== excludeId);
        }
        return formatMessagesForContext(filtered, botId);
    } catch (err) {
        logger.warn(`Failed to fetch context for channel ${channel.id}: ${err.message}`);
        return [];
    }
}

module.exports = { formatMessagesForContext, fetchAndFormatContext };
