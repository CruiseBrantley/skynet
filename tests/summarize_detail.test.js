const { summarizeUrl } = require('../util/summarize');
const { queryOllama } = require('../util/ollama');
const axios = require('axios');

jest.mock('../util/ollama');
jest.mock('axios');
jest.mock('play-dl');
jest.mock('youtube-captions-scraper');

describe('Summarize Detail Levels', () => {
    const mockUrl = 'https://example.com/article';
    const mockHtml = '<html><body><h1>Test Article</h1><p>This is a long test article with lots of text to ensure it meets the minimum character limit for summarization.</p></body></html>';

    beforeEach(() => {
        jest.clearAllMocks();
        axios.get.mockResolvedValue({ data: mockHtml });
    });

    test('summarizeUrl should use SUCCINCT_PROMPT by default', async () => {
        queryOllama.mockResolvedValue({
            message: { content: 'This is a brief summary.' }
        });

        await summarizeUrl(mockUrl);

        expect(queryOllama).toHaveBeenCalledWith('/api/chat', expect.objectContaining({
            messages: expect.arrayContaining([
                expect.objectContaining({
                    role: 'system',
                    content: expect.stringContaining('extremely brief, one-sentence summary')
                })
            ])
        }));
    });

    test('summarizeUrl should use LONG_PROMPT when isLong is true', async () => {
        queryOllama.mockResolvedValue({
            message: { content: 'This is a detailed summary with points.' }
        });

        await summarizeUrl(mockUrl, true);

        expect(queryOllama).toHaveBeenCalledWith('/api/chat', expect.objectContaining({
            messages: expect.arrayContaining([
                expect.objectContaining({
                    role: 'system',
                    content: expect.stringContaining('detailed but concise summary')
                })
            ])
        }));
    });

    test('summarizeUrl should handle SKIP response', async () => {
        queryOllama.mockResolvedValue({
            message: { content: 'SKIP' }
        });

        const result = await summarizeUrl(mockUrl);
        expect(result).toBeNull();
    });
});
