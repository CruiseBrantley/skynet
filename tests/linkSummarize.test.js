const linkSummarize = require('../events/linkSummarize');
const { summarizeUrl } = require('../util/summarize');

jest.mock('../logger');
jest.mock('../firebase-login', () => {
    const mockRef = {
        once: jest.fn(() => Promise.resolve({
            exists: () => true,
            val: () => true
        }))
    };
    const mockDb = {
        ref: jest.fn(() => mockRef)
    };
    return jest.fn(() => mockDb);
});
jest.mock('../util/summarize', () => ({
    ...jest.requireActual('../util/summarize'),
    summarizeUrl: jest.fn()
}));
jest.mock('../util/ollama', () => ({
    queryLocalOrRemote: jest.fn().mockResolvedValue({
        message: { content: 'YES' }
    })
}));

describe('Link Summarize Event', () => {
    let mockBot;
    let mockMessage;
    let eventHandler;

    beforeEach(() => {
        jest.clearAllMocks();
        mockBot = {
            user: { id: 'bot_123' },
            on: jest.fn((event, handler) => {
                if (event === 'messageCreate') eventHandler = handler;
            })
        };

        mockMessage = {
            author: { bot: false },
            guild: { id: 'guild_123' },
            guildId: 'guild_123',
            createdAt: new Date(),
            channelId: process.env.TEST_CHANNEL || '558430903072718868',
            content: 'Check this: https://example.com',
            mentions: { 
                has: jest.fn(() => false) 
            },
            channel: { sendTyping: jest.fn() },
            reply: jest.fn().mockResolvedValue()
        };

        linkSummarize(mockBot);
    });

    test('skips summarization if the bot is mentioned', async () => {
        mockMessage.mentions.has.mockReturnValue(true);
        
        await eventHandler(mockMessage);

        expect(summarizeUrl).not.toHaveBeenCalled();
        expect(mockMessage.reply).not.toHaveBeenCalled();
    });

    test('processes summarization if the bot is NOT mentioned', async () => {
        mockMessage.mentions.has.mockReturnValue(false);
        summarizeUrl.mockResolvedValue('Excellent article summary.');

        await eventHandler(mockMessage);

        expect(summarizeUrl).toHaveBeenCalledWith('https://example.com', false);
        expect(mockMessage.reply).toHaveBeenCalled();
    });

    test('skips if message is from a bot', async () => {
        mockMessage.author.bot = true;

        await eventHandler(mockMessage);

        expect(summarizeUrl).not.toHaveBeenCalled();
    });

    test('skips if no URL is present', async () => {
        mockMessage.content = 'No link here';

        await eventHandler(mockMessage);

        expect(summarizeUrl).not.toHaveBeenCalled();
    });
});
