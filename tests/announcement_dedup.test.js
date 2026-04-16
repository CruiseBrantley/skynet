const fs = require('fs');
const axios = require('axios');
const botAnnounce = require('../events/botAnnounce');

jest.mock('axios');
jest.mock('fs');
jest.mock('../logger');

describe('botAnnounce Deduplication', () => {
    let mockBot;
    let mockChannel;
    const mockConfig = {
        groups: [
            {
                name: "test_group",
                channel_id: "111",
                streamers: ["broadcaster_1"]
            }
        ],
        socials: {}
    };

    const streamData = {
        broadcaster_id: "broadcaster_1",
        broadcaster_name: "TestStreamer",
        game_name: "Testing Game",
        title: "Live Test",
        thumbnail_url: "http://test.com/{width}x{height}.jpg"
    };

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset the module-level recentAnnouncements map for Each test
        // Since it's a private variable in the module, we might need to 
        // require it fresh or expose a reset if testing becomes frequent.
        // For now, we'll rely on the first test to set it and the second to check it.
        
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

    test('first announcement succeeds, second one within cooldown fails', async () => {
        // First announcement
        await botAnnounce(mockBot, streamData);
        expect(mockChannel.send).toHaveBeenCalledTimes(1);

        // Immediate second announcement (same broadcaster)
        await botAnnounce(mockBot, streamData);
        
        // Should STILL be 1 from the first call
        expect(mockChannel.send).toHaveBeenCalledTimes(1);
    });

    test('announcement for a DIFFERENT streamer succeeds even if another is on cooldown', async () => {
        const otherStreamData = {
            broadcaster_id: "broadcaster_2",
            broadcaster_name: "OtherStreamer",
            game_name: "Other Game",
            title: "Other Live",
            thumbnail_url: "http://test.com/other.jpg"
        };
        // Ensure broadcaster_2 is in config
        mockConfig.groups[0].streamers.push("broadcaster_2");
        fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

        await botAnnounce(mockBot, otherStreamData);
        expect(mockChannel.send).toHaveBeenCalledTimes(1);
    });
});
