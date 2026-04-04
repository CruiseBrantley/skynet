const { EmbedBuilder } = require('discord.js');
const twitchListCmd = require('../commands/twitch-list');
const fs = require('fs');
const axios = require('axios');
const getOAuthToken = require('../server/oauth');

jest.mock('fs');
jest.mock('axios');
jest.mock('../server/oauth');

describe('/twitch-list', () => {
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
        socials: {
            "9999": { youtube: "https://youtube.com/test" }
        }
    };

    beforeEach(() => {
        jest.clearAllMocks();
        fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
        getOAuthToken.mockResolvedValue('mock_token');
        
        mockInteraction = {
            guildId: 'G123',
            guild: { name: 'Test Guild' },
            options: {},
            reply: jest.fn(),
            deferReply: jest.fn(),
            editReply: jest.fn()
        };
    });

    test('list command resolves IDs and displays socials', async () => {
        // Mock Twitch API response
        axios.get.mockResolvedValueOnce({ 
            data: { 
                data: [
                    { id: "9999", display_name: "ResolvedStreamer" }
                ] 
            } 
        });

        await twitchListCmd.execute(mockInteraction);

        expect(mockInteraction.deferReply).toHaveBeenCalled();
        const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
        expect(embed.data.title).toContain('Test Guild');
        expect(embed.data.fields[0].value).toContain('ResolvedStreamer');
        expect(embed.data.fields[0].value).toContain('youtube');
    });

    test('returns error if no groups configured for guild', async () => {
        mockInteraction.guildId = 'UNKNOWN_GUILD';
        await twitchListCmd.execute(mockInteraction);
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            content: 'No announcement groups configured for this server.'
        }));
    });
});
