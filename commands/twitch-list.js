const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const getOAuthToken = require('../server/oauth');

const configPath = path.join(__dirname, '../config/announcements.json');

function loadConfig() {
    try {
        const data = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return { groups: [], socials: {} };
    }
}

async function getTwitchUsersByIds(ids) {
    if (ids.length === 0) return new Map();
    const token = await getOAuthToken();
    const response = await axios.get('https://api.twitch.tv/helix/users', {
        headers: {
            'Client-ID': process.env.TWITCH_CLIENTID,
            'Authorization': `Bearer ${token}`
        },
        params: { id: ids }
    });
    const map = new Map();
    response.data.data.forEach(user => map.set(user.id, user.display_name));
    return map;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('twitch-list')
        .setDescription('List all Twitch streamers and announcement groups for this server'),

    async execute(interaction) {
        await interaction.deferReply();
        const config = loadConfig();
        const guildId = interaction.guildId;
        const guildGroups = config.groups.filter(g => g.guild_id === guildId);
        
        if (guildGroups.length === 0) {
            return interaction.editReply({ content: 'No announcement groups configured for this server.', ephemeral: true });
        }

        // Gather all IDs to resolve
        const allIds = [...new Set(guildGroups.flatMap(g => g.streamers))];
        const nameMap = await getTwitchUsersByIds(allIds);

        const embed = new EmbedBuilder()
            .setTitle(`Twitch Announcements - ${interaction.guild.name}`)
            .setColor('#6441a5');

        guildGroups.forEach(group => {
            const names = group.streamers.map(id => {
                const name = nameMap.get(id) || `Unknown User (${id})`;
                const socials = config.socials && config.socials[id];
                if (socials && Object.keys(socials).length > 0) {
                    const socialList = Object.entries(socials)
                        .map(([plat, url]) => `  └ [${plat}](${url})`)
                        .join('\n');
                    return `${name}\n${socialList}`;
                }
                return name;
            });
            const mentionText = group.mention !== undefined ? group.mention : '@everyone';
            
            embed.addFields({
                name: `Group: ${group.name} (Channel: <#${group.channel_id}>)`,
                value: `**Mention:** ${mentionText}\n**Streamers:**\n${names.length > 0 ? names.join('\n') : '*No streamers*'}`
            });
        });

        return interaction.editReply({ embeds: [embed] });
    },
};
