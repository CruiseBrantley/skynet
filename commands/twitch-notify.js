const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const getOAuthToken = require('../server/oauth');
const logger = require('../logger');

const configPath = path.join(__dirname, '../config/announcements.json');

function loadConfig() {
    try {
        const data = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return { groups: [], socials: {} };
    }
}

function saveConfig(config) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

async function getTwitchUser(identifier) {
    const token = await getOAuthToken();
    const isId = /^\d+$/.test(identifier);
    const params = isId ? { id: identifier } : { login: identifier.toLowerCase() };
    
    const response = await axios.get('https://api.twitch.tv/helix/users', {
        headers: {
            'Client-ID': process.env.TWITCH_CLIENTID,
            'Authorization': `Bearer ${token}`
        },
        params: params
    });
    
    let user = response.data.data[0];
    
    // Fallback if a numeric string was actually a username
    if (!user && isId) {
        const fallback = await axios.get('https://api.twitch.tv/helix/users', {
            headers: {
                'Client-ID': process.env.TWITCH_CLIENTID,
                'Authorization': `Bearer ${token}`
            },
            params: { login: identifier.toLowerCase() }
        });
        user = fallback.data.data[0];
    }
    
    return user;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('twitch-notify')
        .setDescription('Manage Twitch announcements (Moderators Only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a streamer to an announcement group')
                .addStringOption(option => option.setName('username').setDescription('Twitch username or ID').setRequired(true))
                .addStringOption(option => option.setName('group').setDescription('Group name').setRequired(true))
                .addChannelOption(option => 
                    option.setName('channel')
                        .setDescription('Announcement channel (Required for new groups)')
                        .addChannelTypes(ChannelType.GuildText))
                .addStringOption(option => option.setName('mention').setDescription('Custom mention (e.g. @everyone or a role ID)')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a streamer from a group')
                .addStringOption(option => option.setName('username').setDescription('Twitch username or ID').setRequired(true))
                .addStringOption(option => option.setName('group').setDescription('Group name').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('social')
                .setDescription('Manage supplemental social links (e.g. youtube) for a streamer')
                .addStringOption(option => option.setName('username').setDescription('Twitch username or ID').setRequired(true))
                .addStringOption(option => option.setName('platform').setDescription('The platform (e.g. youtube)').setRequired(true))
                .addStringOption(option => option.setName('link').setDescription('The URL to the profile (Omit to remove)')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit-group')
                .setDescription('Update the settings for an announcement group')
                .addStringOption(option => option.setName('group').setDescription('Group name').setRequired(true))
                .addChannelOption(option => 
                    option.setName('channel')
                        .setDescription('New announcement channel')
                        .addChannelTypes(ChannelType.GuildText))
                .addStringOption(option => option.setName('mention').setDescription('New custom mention string')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete-group')
                .setDescription('Permanently delete an announcement group from this server')
                .addStringOption(option => option.setName('group').setDescription('Group name').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('sync')
                .setDescription('Manually re-subscribe to all streamers')),

    async execute(interaction) {
        const ownerId = process.env.OWNER_ID;
        const botId = process.env.CLIENT_ID;

        // Discord handles UI visibility via setDefaultMemberPermissions, 
        // but we keep the owner/bot check for robustness and manual overrides.
        const isMod = interaction.member && (
            interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) || 
            interaction.member.permissions.has(PermissionFlagsBits.Administrator)
        );
        const isOwner = interaction.user.id === ownerId;
        const isBot = interaction.user.id === botId;

        if (!isMod && !isOwner && !isBot) {
            return interaction.reply({ content: 'Only server moderators or the bot owner can manage announcements.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        const config = loadConfig();
        const guildId = interaction.guildId;

        if (subcommand === 'edit-group') {
            const groupName = interaction.options.getString('group');
            const channel = interaction.options.getChannel('channel');
            const mention = interaction.options.getString('mention');
            const group = config.groups.find(g => g.name === groupName && g.guild_id === guildId);

            if (!group) {
                return interaction.reply({ content: `Group "${groupName}" not found in this server.`, ephemeral: true });
            }

            let response = `Successfully updated settings for group **${groupName}**:`;
            
            if (channel) {
                group.channel_id = channel.id;
                response += `\n- Channel: <#${channel.id}>`;
            }
            if (mention !== null) {
                group.mention = mention;
                response += `\n- Mention: ${mention || '*None*'}`;
            }

            if (!channel && mention === null) {
                return interaction.reply({ content: 'Please provide at least one setting to update (channel or mention).', ephemeral: true });
            }

            saveConfig(config);
            if (interaction.client.configSync) {
                interaction.client.configSync.updateRemote(config);
            }

            return interaction.reply({ content: response, ephemeral: true });
        }

        if (subcommand === 'delete-group') {
            const groupName = interaction.options.getString('group');
            const groupIndex = config.groups.findIndex(g => g.name === groupName && g.guild_id === guildId);

            if (groupIndex === -1) {
                return interaction.reply({ content: `Group "${groupName}" not found in this server.`, ephemeral: true });
            }

            config.groups.splice(groupIndex, 1);
            saveConfig(config);
            if (interaction.client.configSync) {
                interaction.client.configSync.updateRemote(config);
            }

            return interaction.reply({ content: `Successfully deleted group **${groupName}** and all its streamer associations.`, ephemeral: true });
        }

        if (subcommand === 'social') {
            await interaction.deferReply();
            try {
                const identifier = interaction.options.getString('username');
                const platform = interaction.options.getString('platform').toLowerCase();
                const link = interaction.options.getString('link');

                const user = await getTwitchUser(identifier);
                if (!user) {
                    return interaction.editReply(`Twitch user "${identifier}" not found.`);
                }

                if (!config.socials) config.socials = {};
                if (!config.socials[user.id]) config.socials[user.id] = {};

                if (link) {
                    config.socials[user.id][platform] = link;
                    saveConfig(config);
                    if (interaction.client.configSync) {
                        interaction.client.configSync.updateRemote(config);
                    }
                    return interaction.editReply(`Successfully set **${platform}** for **${user.display_name}** to: ${link}`);
                } else {
                    if (config.socials[user.id][platform]) {
                        delete config.socials[user.id][platform];
                        
                        // Cleanup empty objects
                        if (Object.keys(config.socials[user.id]).length === 0) {
                            delete config.socials[user.id];
                        }

                        saveConfig(config);
                        if (interaction.client.configSync) {
                            interaction.client.configSync.updateRemote(config);
                        }
                        return interaction.editReply(`Successfully removed **${platform}** from **${user.display_name}**.`);
                    } else {
                        return interaction.editReply(`No **${platform}** link found for **${user.display_name}**.`);
                    }
                }
            } catch (err) {
                logger.error('Error managing social link:', err);
                return interaction.editReply('Failed to manage social link. Check logs.');
            }
        }

        if (subcommand === 'sync') {
            await interaction.deferReply();
            try {
                const { subscribeAll } = require('../server/server');
                await subscribeAll();
                return interaction.editReply('Successfully re-subscribed to all Twitch updates.');
            } catch (err) {
                logger.error('Error syncing twitch subscriptions:', err);
                return interaction.editReply('Failed to sync subscriptions. Check logs.');
            }
        }

        const username = interaction.options.getString('username')?.toLowerCase();
        const groupName = interaction.options.getString('group');
        
        let group = config.groups.find(g => g.name === groupName && g.guild_id === guildId);

        if (subcommand === 'add') {
            if (!username) return interaction.reply({ content: 'Username is required.', ephemeral: true });
            await interaction.deferReply();
            try {
                const channel = interaction.options.getChannel('channel');
                const mention = interaction.options.getString('mention');
                
                if (!group) {
                    if (!channel) {
                        return interaction.editReply(`New group "${groupName}" requires a channel! Please specify the \`channel\` option.`);
                    }
                    group = {
                        name: groupName,
                        channel_id: channel.id,
                        guild_id: guildId,
                        streamers: [],
                        mention: mention !== null ? mention : '@everyone'
                    };
                    config.groups.push(group);
                } else if (mention !== null) {
                    group.mention = mention;
                }

                const user = await getTwitchUser(username);
                if (!user) {
                    return interaction.editReply(`Twitch user "${username}" not found.`);
                }

                if (group.streamers.includes(user.id)) {
                    return interaction.editReply(`"${username}" is already in group "${groupName}".`);
                }

                group.streamers.push(user.id);
                saveConfig(config);
                
                if (interaction.client.configSync) {
                    interaction.client.configSync.updateRemote(config);
                }

                let successMsg = `Successfully added **${user.display_name}** to group **${groupName}** (Channel: <#${group.channel_id}>).`;
                if (mention !== null) successMsg += `\nMention updated to: ${mention || '*None*'}`;
                successMsg += `\nNote: Use \`/twitch-notify sync\` to activate.`;

                await interaction.editReply(successMsg);
            } catch (err) {
                logger.error('Error adding twitch user:', err);
                await interaction.editReply('Failed to add Twitch user. Check logs.');
            }
        }

        if (subcommand === 'remove') {
            if (!username) return interaction.reply({ content: 'Username is required.', ephemeral: true });
            if (!group) {
                return interaction.reply({ content: `Group "${groupName}" not found in this server.`, ephemeral: true });
            }

            await interaction.deferReply();
            try {
                const user = await getTwitchUser(username);
                if (!user) {
                    return interaction.editReply(`Twitch user "${username}" not found.`);
                }

                const index = group.streamers.indexOf(user.id);
                if (index === -1) {
                    return interaction.editReply(`"${username}" is not in group "${groupName}".`);
                }

                group.streamers.splice(index, 1);
                
                saveConfig(config);
                if (interaction.client.configSync) {
                    interaction.client.configSync.updateRemote(config);
                }

                await interaction.editReply(`Successfully removed **${user.display_name}** from group **${groupName}**.`);
            } catch (err) {
                logger.error('Error removing twitch user:', err);
                await interaction.editReply('Failed to remove Twitch user. Check logs.');
            }
        }
    },
};
