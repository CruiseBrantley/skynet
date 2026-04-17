const chatCmd = require('../commands/chat');
const { MessageFlags } = require('discord.js');
const googleIt = require('google-it');
const ddg = require('duck-duck-scrape');
const wiki = require('wikipedia');
const ollama = require('../util/ollama');

jest.mock('google-it');
jest.mock('duck-duck-scrape');
jest.mock('wikipedia');
jest.mock('../util/ollama');
jest.mock('../logger');

describe('Chat Command Search Integration', () => {
    let mockInteraction;

    beforeEach(() => {
        jest.clearAllMocks();
        mockInteraction = {
            id: '123',
            user: { tag: 'user#0001', username: 'user' },
            client: { user: { id: 'mock_bot_id' }, commands: { map: jest.fn().mockReturnValue([]) } },
            channelId: 'channel-1',
            options: {
                getString: jest.fn().mockImplementation((name) => {
                    if (name === 'message') return 'how is the weather in Fayetteville?';
                    return null;
                }),
                getAttachment: jest.fn(),
                attachments: { size: 0 }
            },
            deferReply: jest.fn(),
            editReply: jest.fn(),
            followUp: jest.fn(),
            deleteReply: jest.fn(),
            channel: { send: jest.fn() }
        };
    });

    test('successfully summarizes search results', async () => {
        mockInteraction.options.getString.mockReturnValue('how is the weather in Fayetteville?');
        
        // Mocking Ollama's first response (requesting a search)
        ollama.queryOllama.mockResolvedValueOnce({
            message: {
                role: 'assistant',
                content: '<<<RUN_COMMAND: {"command": "search", "query": "weather in Fayetteville AR"}>>>'
            }
        });

        // Mocking search results
        googleIt.mockResolvedValueOnce([
            { title: 'Weather in Fayetteville', snippet: 'It is 70 degrees and sunny.', link: 'http://weather.com' }
        ]);

        // Mocking Ollama's second response (summarizing)
        ollama.queryOllama.mockResolvedValueOnce({
            message: {
                role: 'assistant',
                content: 'The weather in Fayetteville, AR is currently 70 degrees and sunny.'
            }
        });

        await chatCmd.execute(mockInteraction);

        expect(googleIt).toHaveBeenCalled();
        expect(ollama.queryOllama).toHaveBeenCalledTimes(2);
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('The weather in Fayetteville, AR is currently 70 degrees and sunny.')
        }));
    });

    test('handles search failures by informing the LLM', async () => {
        mockInteraction.options.getString.mockReturnValue('what happened today?');
        
        ollama.queryOllama.mockResolvedValueOnce({
            message: {
                role: 'assistant',
                content: '<<<RUN_COMMAND: {"command": "search", "query": "news today"}>>>'
            }
        });

        googleIt.mockRejectedValueOnce(new Error('Rate limited'));
        ddg.search.mockRejectedValueOnce(new Error('Rate limited'));
        wiki.summary.mockRejectedValueOnce(new Error('Not found'));

        ollama.queryOllama.mockResolvedValueOnce({
            message: {
                role: 'assistant',
                content: 'I attempted to search the web, but I am currently unable to retrieve real-time news.'
            }
        });

        await chatCmd.execute(mockInteraction);

        expect(ollama.queryOllama).toHaveBeenCalledTimes(2);
        // Verify system message informs about failure
        const secondCallPayload = ollama.queryOllama.mock.calls[1][1];
        const secondCallMessages = secondCallPayload.messages;
        expect(secondCallMessages[secondCallMessages.length - 1].content).toContain('WEB SEARCH UNAVAILABLE');
    });
});
