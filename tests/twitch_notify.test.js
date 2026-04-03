const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const twitchNotifyCmd = require('../commands/twitch-notify');
const fs = require('fs');
const axios = require('axios');
const getOAuthToken = require('../server/oauth');

jest.mock('fs');
jest.mock('axios');
jest.mock('../server/oauth');
jest.mock('../logger');

describe('/twitch-notify', () => {
    let mockInteraction;
    const mockConfig = {
        groups: [
            {
                name: "test_group",
                channel_id: "12345",
                guild_id: "G123",
                streamers: ["9999"]
            },
            {
                name: "other_group",
                channel_id: "67890",
                guild_id: "G456",
                streamers: ["7777"]
            }
        ],
        socials: {}
    };

    beforeEach(() => {
        jest.clearAllMocks();
        fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
        getOAuthToken.mockResolvedValue('mock_token');
        // Default axios mock to prevent crashes in background lookups
        axios.get.mockResolvedValue({ data: { data: [] } });

        mockInteraction = {
            guildId: 'G123',
            guild: { name: 'Test Guild' },
            user: {
                id: '199749017150816256' // Mock owner ID
            },
            member: {
                permissions: {
                    has: jest.fn()
                }
            },
            options: {
                getSubcommand: jest.fn(),
                getString: jest.fn(),
                getChannel: jest.fn()
            },
            reply: jest.fn(),
            deferReply: jest.fn(),
            editReply: jest.fn(),
            client: {
                configSync: {
                    updateRemote: jest.fn()
                }
            }
        };
        process.env.OWNER_ID = '199749017150816256';
    });

    test('returns error if user is NOT the owner AND NOT an admin', async () => {
        mockInteraction.user.id = 'unauthorized_user';
        mockInteraction.member.permissions.has.mockReturnValue(false); // Not an admin
        await twitchNotifyCmd.execute(mockInteraction);
        expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: 'Only server administrators, the bot owner, or Skynet can manage announcements.',
            ephemeral: true
        }));
    });

    test('allows a guild admin who is NOT the owner', async () => {
        mockInteraction.user.id = 'another_user';
        mockInteraction.member.permissions.has.mockReturnValue(true); // Is an admin
        mockInteraction.options.getSubcommand.mockReturnValue('list');

        await twitchNotifyCmd.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            embeds: expect.any(Array)
        }));
    });

    test('list subcommand resolves IDs to names for the current guild', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('list');
        
        // Mock Twitch API response for bulk lookup
        axios.get.mockResolvedValueOnce({ 
            data: { 
                data: [
                    { id: "9999", display_name: "ResolvedStreamer" }
                ] 
            } 
        });

        await twitchNotifyCmd.execute(mockInteraction);

        expect(mockInteraction.deferReply).toHaveBeenCalled();
        const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
        expect(embed.data.fields[0].value).toContain('ResolvedStreamer');
    });

    test('add subcommand successfully handles Twitch ID strings', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('add');
        mockInteraction.options.getString.mockImplementation(name => {
            if (name === 'username') return '12345'; // Numeric string as ID
            if (name === 'group') return 'test_group';
        });
        mockInteraction.options.getChannel.mockReturnValue(null);

        // Mock 1st call (ID search) successfully
        axios.get.mockResolvedValueOnce({ data: { data: [{ id: "12345", display_name: "IDStreamer" }] } });

        await twitchNotifyCmd.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining('Successfully added **IDStreamer**'));
    });

    test('add subcommand successfully handles numeric strings that are actually usernames', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('add');
        mockInteraction.options.getString.mockImplementation(name => {
            if (name === 'username') return '11111'; // Looks like ID but is username
            if (name === 'group') return 'test_group';
        });

        // 1st call (ID search) -> No results
        axios.get.mockResolvedValueOnce({ data: { data: [] } });
        // 2nd call (Login search) -> Found!
        axios.get.mockResolvedValueOnce({ data: { data: [{ id: "9988", display_name: "11111" }] } });

        await twitchNotifyCmd.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining('Successfully added **11111**'));
    });

    test('add subcommand successfully creates a new group for the current guild', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('add');
        mockInteraction.options.getString.mockImplementation(name => {
            if (name === 'username') return 'new_streamer';
            if (name === 'group') return 'new_guild_group';
        });
        mockInteraction.options.getChannel.mockReturnValue({ id: 'CH_NEW' });

        axios.get.mockResolvedValue({ data: { data: [{ id: "5555", display_name: "NewStreamer" }] } });

        await twitchNotifyCmd.execute(mockInteraction);

        expect(fs.writeFileSync).toHaveBeenCalled();
        const savedConfig = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        const newGroup = savedConfig.groups.find(g => g.name === 'new_guild_group');
        expect(newGroup.guild_id).toBe('G123');
    });

    test('remove subcommand only identifies groups for the current guild', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('remove');
        mockInteraction.options.getString.mockImplementation(name => {
            if (name === 'username') return 'streamer';
            if (name === 'group') return 'other_group'; // other_group exists but in guild G456
        });

        await twitchNotifyCmd.execute(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: 'Group "other_group" not found in this server.'
        }));
    });

    test('edit-group subcommand updates the channel_id and mention for a group', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('edit-group');
        mockInteraction.options.getString.mockImplementation(name => {
            if (name === 'group') return 'test_group';
            if (name === 'mention') return '@here';
        });
        mockInteraction.options.getChannel.mockReturnValue({ id: 'NEW_CHANNEL_ID' });

        await twitchNotifyCmd.execute(mockInteraction);

        expect(fs.writeFileSync).toHaveBeenCalled();
        const savedConfig = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        const group = savedConfig.groups.find(g => g.name === 'test_group');
        expect(group.channel_id).toBe('NEW_CHANNEL_ID');
        expect(group.mention).toBe('@here');
    });

    test('add subcommand successfully handles custom mentions', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('add');
        mockInteraction.options.getString.mockImplementation(name => {
            if (name === 'username') return 'new_streamer';
            if (name === 'group') return 'test_group';
            if (name === 'mention') return '<@&123456789>'; // Role mention
        });
        mockInteraction.options.getChannel.mockReturnValue(null);

        axios.get.mockResolvedValueOnce({ data: { data: [{ id: "5555", display_name: "NewStreamer" }] } });

        await twitchNotifyCmd.execute(mockInteraction);

        const savedConfig = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        const group = savedConfig.groups.find(g => g.name === 'test_group');
        expect(group.mention).toBe('<@&123456789>');
    });

    test('delete-group subcommand removes a group entirely', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('delete-group');
        mockInteraction.options.getString.mockReturnValue('test_group');

        await twitchNotifyCmd.execute(mockInteraction);

        expect(fs.writeFileSync).toHaveBeenCalled();
        const savedConfig = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        const groupExist = savedConfig.groups.some(g => g.name === 'test_group' && g.guild_id === 'G123');
        expect(groupExist).toBe(false);
    });
});
