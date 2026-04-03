const fs = require('fs');
const axios = require('axios');
const botAnnounce = require('../events/botAnnounce');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');

jest.mock('axios');
jest.mock('fs');
jest.mock('../logger');

describe('botAnnounce', () => {
    let mockBot;
    let mockChannel;
    const mockConfig = {
        groups: [
            {
                name: "test_group",
                channel_id: "111222333",
                streamers: ["999888"]
            }
        ],
        socials: {
            "999888": { youtube: "https://youtube.com/test" }
        }
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockChannel = {
            send: jest.fn().mockResolvedValue({})
        };
        mockBot = {
            channels: {
                fetch: jest.fn().mockResolvedValue(mockChannel)
            }
        };
        fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
        axios.get.mockResolvedValue({ data: Buffer.from('test_image') });
    });

    test('successfully sends an announcement for a matched streamer', async () => {
        const streamData = {
            broadcaster_id: "999888",
            broadcaster_name: "TestStreamer",
            game_name: "Testing Game",
            title: "Live Test",
            thumbnail_url: "http://test.com/{width}x{height}.jpg"
        };

        await botAnnounce(mockBot, streamData);

        expect(mockBot.channels.fetch).toHaveBeenCalledWith("111222333");
        expect(mockChannel.send).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('@everyone TestStreamer has gone Live!'),
            embeds: expect.any(Array),
            files: expect.any(Array)
        }));
    });

    test('skips announcement for streamers not in config', async () => {
        const unknownStreamData = {
            broadcaster_id: "000000",
            broadcaster_name: "Unknown",
            game_name: "Ghost Game",
            title: "Ghost Live"
        };

        await botAnnounce(mockBot, unknownStreamData);

        expect(mockChannel.send).not.toHaveBeenCalled();
    });

    test('handles malformed config gracefully', async () => {
        fs.readFileSync.mockReturnValue('invalid-json');
        
        await botAnnounce(mockBot, { broadcaster_id: "999888" });

        expect(mockChannel.send).not.toHaveBeenCalled();
    });
});
