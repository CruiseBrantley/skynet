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
            }
        ],
        socials: {}
    };

    beforeEach(() => {
        jest.clearAllMocks();
        fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
        getOAuthToken.mockResolvedValue('mock_token');
        // Default axios mock
        axios.get.mockResolvedValue({ data: { data: [] } });

        mockInteraction = {
            guildId: 'G123',
            member: {
                permissions: {
                    has: jest.fn()
                }
            },
            user: { id: '199749017150816256' }, // Mock owner ID
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

    test('returns error if user is NOT a moderator OR owner', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('add');
        mockInteraction.user.id = 'unauthorized_user';
        mockInteraction.member.permissions.has.mockReturnValue(false); 
        
        await twitchNotifyCmd.execute(mockInteraction);
        
        expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: 'Only server moderators, the bot owner, or Skynet can manage announcements.',
            ephemeral: true
        }));
    });

    test('allows a moderator (ManageMessages) to run management commands', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('add');
        mockInteraction.user.id = 'moderator_user';
        mockInteraction.member.permissions.has.mockImplementation((perm) => {
            return perm === PermissionFlagsBits.ManageMessages;
        });
        mockInteraction.options.getString.mockImplementation((name) => {
            if (name === 'username') return 'streamer';
            if (name === 'group') return 'test_group';
            return null;
        });

        axios.get.mockResolvedValueOnce({ data: { data: [{ id: "8888", display_name: "NewStreamer" }] } });

        await twitchNotifyCmd.execute(mockInteraction);

        expect(mockInteraction.deferReply).toHaveBeenCalled();
        expect(fs.writeFileSync).toHaveBeenCalled();
    });

    test('add subcommand successfully handles Twitch ID strings', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('add');
        mockInteraction.member.permissions.has.mockReturnValue(true);
        mockInteraction.options.getString.mockImplementation(name => {
            if (name === 'username') return '12345';
            if (name === 'group') return 'test_group';
        });

        axios.get.mockResolvedValueOnce({ data: { data: [{ id: "12345", display_name: "IDStreamer" }] } });

        await twitchNotifyCmd.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining('Successfully added **IDStreamer**'));
    });

    test('add subcommand successfully handle numeric strings that are actually usernames', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('add');
        mockInteraction.member.permissions.has.mockReturnValue(true);
        mockInteraction.options.getString.mockImplementation(name => {
            if (name === 'username') return '11111';
            if (name === 'group') return 'test_group';
        });

        axios.get.mockResolvedValueOnce({ data: { data: [] } });
        axios.get.mockResolvedValueOnce({ data: { data: [{ id: "9988", display_name: "11111" }] } });

        await twitchNotifyCmd.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining('Successfully added **11111**'));
    });

    test('add subcommand successfully creates a new group for the current guild', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('add');
        mockInteraction.member.permissions.has.mockReturnValue(true);
        mockInteraction.options.getString.mockImplementation(name => {
            if (name === 'username') return 'new_streamer';
            if (name === 'group') return 'new_guild_group';
        });
        mockInteraction.options.getChannel.mockReturnValue({ id: 'CH_NEW' });

        axios.get.mockResolvedValue({ data: { data: [{ id: "5555", display_name: "NewStreamer" }] } });

        await twitchNotifyCmd.execute(mockInteraction);

        const savedConfig = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        const newGroup = savedConfig.groups.find(g => g.name === 'new_guild_group');
        expect(newGroup.guild_id).toBe('G123');
    });

    test('remove subcommand only identifies groups for the current guild', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('remove');
        mockInteraction.member.permissions.has.mockReturnValue(true);
        mockInteraction.options.getString.mockImplementation(name => {
            if (name === 'username') return 'streamer';
            if (name === 'group') return 'other_group';
        });

        await twitchNotifyCmd.execute(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: 'Group "other_group" not found in this server.'
        }));
    });

    test('edit-group subcommand updates settings', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('edit-group');
        mockInteraction.member.permissions.has.mockReturnValue(true);
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

    test('delete-group subcommand removes a group', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('delete-group');
        mockInteraction.member.permissions.has.mockReturnValue(true);
        mockInteraction.options.getString.mockReturnValue('test_group');

        await twitchNotifyCmd.execute(mockInteraction);

        expect(fs.writeFileSync).toHaveBeenCalled();
        const savedConfig = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        expect(savedConfig.groups.some(g => g.name === 'test_group')).toBe(false);
    });

    test('social subcommand sets a link', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('social');
        mockInteraction.member.permissions.has.mockReturnValue(true);
        mockInteraction.options.getString.mockImplementation(name => {
            if (name === 'username') return 'streamer';
            if (name === 'platform') return 'youtube';
            if (name === 'link') return 'https://youtube.com/user';
        });

        axios.get.mockResolvedValueOnce({ data: { data: [{ id: "9999", display_name: "Streamer" }] } });

        await twitchNotifyCmd.execute(mockInteraction);

        const savedConfig = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        expect(savedConfig.socials["9999"].youtube).toBe('https://youtube.com/user');
    });
});
