const { EmbedBuilder } = require('discord.js');

const COLOR_MAP = {
    blue: 0x5865F2, green: 0x57F287, red: 0xED4245,
    yellow: 0xFEE75C, purple: 0x9B59B6, orange: 0xE67E22,
    white: 0xFFFFFF, black: 0x23272A, teal: 0x1ABC9C,
    gold: 0xF1C40F, pink: 0xFF69B4, cyan: 0x00FFFF
};

module.exports = {
    name: 'send_embed',
    description: 'Sends a rich Discord embed with a title, description, color, optional fields, and footer',
    schema: {
        title: 'string — embed title',
        description: 'string — main body text of the embed',
        color: 'string|number — color name (blue, green, red, etc.) or hex number (default: blue)',
        fields: 'array of { name: string, value: string, inline?: boolean } objects',
        footer: 'string — optional footer text',
        thumbnail: 'string — optional thumbnail image URL',
        image: 'string — optional large image URL'
    },
    execute: async (bot, channel, params) => {
        const color = typeof params.color === 'string'
            ? (COLOR_MAP[params.color.toLowerCase()] ?? parseInt(params.color.replace('#', ''), 16) ?? 0x5865F2)
            : (params.color ?? 0x5865F2);

        const embed = new EmbedBuilder()
            .setTitle((params.title || '').substring(0, 256) || 'Skynet Notification')
            .setDescription((params.description || params.content || '').substring(0, 4096))
            .setColor(color)
            .setTimestamp();

        if (params.footer) embed.setFooter({ text: String(params.footer).substring(0, 2048) });
        if (params.thumbnail) embed.setThumbnail(params.thumbnail);
        if (params.image) embed.setImage(params.image);

        if (Array.isArray(params.fields)) {
            const validFields = params.fields
                .filter(f => f.name && f.value)
                .slice(0, 25)
                .map(f => ({
                    name: String(f.name).substring(0, 256),
                    value: String(f.value).substring(0, 1024),
                    inline: Boolean(f.inline)
                }));
            if (validFields.length > 0) embed.addFields(validFields);
        }

        // Ensure the embed has content to avoid "Invalid Form Body"
        if (!embed.data.title && !embed.data.description && (!embed.data.fields || embed.data.fields.length === 0)) {
            embed.setDescription('Action executed successfully but returned no text.');
        }

        await channel.send({ embeds: [embed] });
    }
};
