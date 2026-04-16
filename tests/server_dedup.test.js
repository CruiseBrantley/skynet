const botAnnounce = require('../events/botAnnounce');
const axios = require('axios');

// Mock express before requiring server
jest.mock('express', () => {
    const mockApp = {
        use: jest.fn(),
        get: jest.fn(),
        post: jest.fn(),
        listen: jest.fn()
    };
    const mockExpress = jest.fn(() => mockApp);
    mockExpress.json = jest.fn(() => (req, res, next) => next());
    return mockExpress;
});

jest.mock('../logger');
jest.mock('../events/botAnnounce');
jest.mock('../server/oauth', () => jest.fn().mockResolvedValue('mock_token'));
jest.mock('../server/ngrok', () => jest.fn().mockResolvedValue('http://mock.ngrok.io'));
jest.mock('axios');

describe('Server Webhook Deduplication', () => {
    let mockBot;
    let mockApp;

    beforeEach(() => {
        jest.clearAllMocks();
        mockBot = { channels: { fetch: jest.fn() } };
        
        const { setupServer } = require('../server/server');
        mockApp = setupServer(mockBot);
    });

    test('ignores duplicate webhooks with the same message-id', async () => {
        // Find the POST handler that was registered
        const postCall = mockApp.post.mock.calls.find(call => call[0] === '/');
        const postHandler = postCall[1];

        const messageId = 'msg_unique_999';
        const req = {
            headers: { 'twitch-eventsub-message-id': messageId },
            body: {
                subscription: { id: 'sub_unique' },
                event: { broadcaster_user_id: 'user_unique' }
            }
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
            type: jest.fn().mockReturnThis()
        };

        // Mock internal helper results
        axios.get.mockResolvedValueOnce({ data: { data: [{ id: 'user_unique', game_id: 'game_unique' }] } }); // getChannelInfo
        axios.get.mockResolvedValueOnce({ data: { data: [{ name: 'Test Game' }] } }); // getGameInfo

        // First call
        await postHandler(req, res);
        expect(botAnnounce).toHaveBeenCalledTimes(1);

        // Second call with same messageId
        await postHandler(req, res);
        expect(res.send).toHaveBeenCalledWith('Deduplicated');
        // Still only 1 call to botAnnounce
        expect(botAnnounce).toHaveBeenCalledTimes(1);
    });
});
