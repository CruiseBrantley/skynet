const { getSubscriptions, twitchSubscribe, subscribeAll } = require('../server/server')
const axios = require('axios')
const fs = require('fs')

jest.mock('axios')
jest.mock('fs')
jest.mock('../logger')
jest.mock('../server/ngrok', () => jest.fn().mockResolvedValue('http://mock.ngrok.io'))
jest.mock('../server/oauth', () => jest.fn().mockResolvedValue('mock_token'))

describe('Twitch API & Subscriptions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Setup default mock for getSubscriptions to avoid loops in subscribeAll
        axios.get.mockResolvedValue({ data: { total: 0, data: [] } });
    });

    test('Twitch Subscribe', async () => {
        axios.post.mockResolvedValueOnce({ status: 200 })
        const twitchSubscription = await twitchSubscribe('12345', 'http://localhost/test', 'mock_token')
        expect(twitchSubscription).toBe(200)
    })

    test('Get All Twitch Subscriptions', async () => {
        axios.get.mockResolvedValueOnce({ data: { total: 5, data: [] } })
        const subscriptions = await getSubscriptions('mock_token')
        expect(subscriptions.total).toBe(5)
    })

    test('subscribeAll gathers unique streamers from config', async () => {
        const mockConfig = {
            groups: [
                { streamers: ["1", "2"] },
                { streamers: ["2", "3"] }
            ]
        };
        fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
        axios.post.mockResolvedValue({ status: 200 });

        await subscribeAll();

        // 3 unique streamers (1, 2, 3) + 0 existing subs to delete
        // Check that post was called 3 times for new subscriptions
        expect(axios.post).toHaveBeenCalledTimes(3);
    });
})
