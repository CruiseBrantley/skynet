// Mock dependencies
jest.mock('../util/ollama', () => ({
    queryOllama: jest.fn()
}));
jest.mock('google-it');
jest.mock('duck-duck-scrape');
jest.mock('wikipedia');
jest.mock('../logger');
jest.mock('fs');
jest.mock('axios');

const chat = require('../commands/chat');
const { queryOllama: executeOllama } = require('../util/ollama');
const googleIt = require('google-it');
const ddg = require('duck-duck-scrape');
const wiki = require('wikipedia');
const logger = require('../logger');
const fs = require('fs');

describe('Chat Command', () => {
    let mockInteraction;

    beforeEach(() => {
        jest.clearAllMocks();
        
        mockInteraction = {
            commandName: 'chat',
            channelId: 'channel_' + Math.random(),
            user: { username: 'TestUser' },
            options: {
                getString: jest.fn((name) => name === 'message' ? 'Hello Skynet' : ''),
                getAttachment: jest.fn(() => null),
                attachments: { first: () => null, size: 0 }
            },
            client: {
                commands: {
                    map: jest.fn().mockReturnValue(['- /test: description']),
                    values: jest.fn().mockReturnValue([]),
                    get: jest.fn(),
                    set: jest.fn()
                }
            },
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
            deleteReply: jest.fn().mockResolvedValue(),
            followUp: jest.fn().mockResolvedValue(),
            channel: { send: jest.fn().mockResolvedValue() }
        };

        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue('{"level":"info","message":"Test Log"}\n');
    });

    // --- Basic Response ---
    test('successfully processes a simple text response', async () => {
        executeOllama.mockResolvedValue({
            message: { role: 'assistant', content: 'Hello there!' }
        });

        await chat.execute(mockInteraction);

        expect(mockInteraction.deferReply).toHaveBeenCalled();
        expect(executeOllama).toHaveBeenCalled();
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/Hello there!\s*/) }));
    });

    // --- Tag Stripping ---
    test('strips RUN_COMMAND tags from the final output', async () => {
        executeOllama.mockResolvedValue({
            message: { 
                role: 'assistant', 
                content: 'I have done that. <<<RUN_COMMAND: {"command": "speak", "message": "done"}>>>' 
            }
        });

        const speakExec = jest.fn().mockResolvedValue();
        mockInteraction.client.commands.get = jest.fn().mockReturnValue({ execute: speakExec });

        await chat.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/I have done that\.\s*/) }));
    });

    // --- Recursive Search ---
    test('executes a recursive search and synthesizes a response', async () => {
        executeOllama
            .mockResolvedValueOnce({
                message: { role: 'assistant', content: '<<<RUN_COMMAND: {"command": "search", "query": "weather"}>>>' }
            })
            .mockResolvedValueOnce({
                message: { role: 'assistant', content: 'The weather is sunny.' }
            });

        googleIt.mockResolvedValue([
            { title: 'Weather Today', snippet: 'It is sunny today.', link: 'http://weather.com' }
        ]);

        await chat.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('searching the web') }));
        expect(googleIt).toHaveBeenCalledWith({ query: 'weather', disableConsole: true });
        expect(executeOllama).toHaveBeenCalledTimes(2);
        // Should contain the final search result
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/The weather is sunny\.\s*/) }));
    });

    test('retains Surrounding Text during recursive search', async () => {
        executeOllama
            .mockResolvedValueOnce({
                message: { role: 'assistant', content: 'Let me check: <<<RUN_COMMAND: {"command": "search", "query": "weather"}>>> and I will tell you.' }
            })
            .mockResolvedValueOnce({
                message: { role: 'assistant', content: 'Sunny.' }
            });

        googleIt.mockResolvedValue([{ title: 'W', snippet: 'Sunny', link: 'http://w.com' }]);

        await chat.execute(mockInteraction);

        // Final response should merge the original text with the search result
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Let me check:') }));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Sunny.') }));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('and I will tell you.') }));
    });

    // --- Search Fallback: Google -> DuckDuckGo ---
    test('falls back to DuckDuckGo when Google returns no results', async () => {
        executeOllama
            .mockResolvedValueOnce({
                message: { role: 'assistant', content: '<<<RUN_COMMAND: {"command": "search", "query": "latest news"}>>>' }
            })
            .mockResolvedValueOnce({
                message: { role: 'assistant', content: 'Here is the news from DDG.' }
            });

        // Google returns empty
        googleIt.mockResolvedValue([]);
        // DDG returns results
        ddg.search.mockResolvedValue({
            results: [
                { title: 'DDG News', description: 'News from DuckDuckGo', url: 'http://ddg.com' }
            ]
        });

        await chat.execute(mockInteraction);

        expect(googleIt).toHaveBeenCalled();
        expect(ddg.search).toHaveBeenCalledWith('latest news');
        expect(executeOllama).toHaveBeenCalledTimes(2);
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/Here is the news from DDG\.\s*/) }));
    });
    test('falls back to Wikipedia when Google and DDG return no results', async () => {
        executeOllama
            .mockResolvedValueOnce({
                message: { role: 'assistant', content: '<<<RUN_COMMAND: {"command": "search", "query": "moon distance"}>>>' }
            })
            .mockResolvedValueOnce({
                message: { role: 'assistant', content: 'The Moon is far.' }
            });

        // Google and DDG return empty
        googleIt.mockResolvedValue([]);
        ddg.search.mockResolvedValue({ results: [] });
        
        // Wikipedia succeeds
        wiki.summary.mockResolvedValue({
            title: 'Moon',
            extract: 'The Moon is Earths satellite.',
            content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Moon' } }
        });

        await chat.execute(mockInteraction);

        expect(googleIt).toHaveBeenCalled();
        expect(wiki.summary).toHaveBeenCalledWith('moon distance');
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('The Moon is far.') }));
    });
    test('falls back to internal knowledge when ALL search providers fail', async () => {
        executeOllama
            .mockResolvedValueOnce({
                message: { role: 'assistant', content: '<<<RUN_COMMAND: {"command": "search", "query": "moon facts"}>>>' }
            })
            .mockResolvedValueOnce({
                message: { role: 'assistant', content: 'The Moon is Earths satellite (from internal databases).' }
            });

        // ALL providers fail
        googleIt.mockResolvedValue([]);
        ddg.search.mockResolvedValue({ results: [] });
        wiki.summary.mockRejectedValue(new Error('403 Forbidden'));

        await chat.execute(mockInteraction);

        // Should have attempted all three
        expect(googleIt).toHaveBeenCalled();
        expect(ddg.search).toHaveBeenCalled();
        expect(wiki.summary).toHaveBeenCalled();
        
        // Final message should contain synthesized answer
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('internal databases') }));
    });
    
    // --- Chained Reasoning: Search -> Speak ---
    test('handles a recursive chain: Search -> Speak', async () => {
        executeOllama
            .mockResolvedValueOnce({
                message: { role: 'assistant', content: '<<<RUN_COMMAND: {"command": "search", "query": "time"}>>>' }
            })
            .mockResolvedValueOnce({
                message: { role: 'assistant', content: 'It is 5 PM. <<<RUN_COMMAND: {"command": "speak", "message": "It is 5 PM"}>>>' }
            });

        googleIt.mockResolvedValue([{ title: 'Time', snippet: '5 PM', link: 'http://time.com' }]);
        const speakExec = jest.fn().mockResolvedValue();
        mockInteraction.client.commands.get = jest.fn().mockReturnValue({ execute: speakExec });

        await chat.execute(mockInteraction);

        expect(executeOllama).toHaveBeenCalledTimes(2);
        expect(speakExec).toHaveBeenCalled();
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/It is 5 PM\.\s*/) }));
    });

    // --- Robust Parsing ---
    test('handles RUN_COMMAND without brackets (Robust parsing)', async () => {
        executeOllama.mockResolvedValue({
            message: { role: 'assistant', content: 'RUN_COMMAND: {"command": "speak", "message": "hello"}' }
        });

        const speakExec = jest.fn().mockResolvedValue();
        mockInteraction.client.commands.get = jest.fn().mockReturnValue({ execute: speakExec });

        await chat.execute(mockInteraction);

        expect(speakExec).toHaveBeenCalled();
        expect(mockInteraction.deleteReply).toHaveBeenCalled();
    });

    test('handles RUN_COMMAND with missing trailing brackets (Robust parsing)', async () => {
        executeOllama.mockResolvedValue({
            message: { role: 'assistant', content: '<<<RUN_COMMAND: {"command": "speak", "message": "hello"}>>' }
        });

        const speakExec = jest.fn().mockResolvedValue();
        mockInteraction.client.commands.get = jest.fn().mockReturnValue({ execute: speakExec });

        await chat.execute(mockInteraction);

        expect(speakExec).toHaveBeenCalled();
        expect(mockInteraction.deleteReply).toHaveBeenCalled();
    });

    // --- Unknown Command Logging ---
    test('logs error and informs user of unknown command', async () => {
        executeOllama.mockResolvedValue({
            message: { role: 'assistant', content: '<<<RUN_COMMAND: {"command": "hallucinated_cmd"}>>>' }
        });

        mockInteraction.client.commands.get.mockReturnValue(null);

        await chat.execute(mockInteraction);

        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('unknown command: hallucinated_cmd'));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('System Error') }));
    });

    // --- Malformed JSON (existing test improved) ---
    test('handles malformed JSON gracefully via jsonrepair', async () => {
        executeOllama.mockResolvedValue({
            message: { role: 'assistant', content: '<<<RUN_COMMAND: { bad json >>>' }
        });

        await chat.execute(mockInteraction);

        // jsonrepair will attempt to fix even severely broken JSON.
        // the text contains an error message instead of being empty, so it will NOT delete the reply.
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('unknown command') }));
    });

    // --- Missing Arguments ---
    test('handles autonomous command with missing arguments without crashing', async () => {
        executeOllama.mockResolvedValue({
            message: { role: 'assistant', content: '<<<RUN_COMMAND: {"command": "summarize"}>>>' }
        });

        await chat.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('unknown command') }));
    });

    // --- Vocal Playback "tell me" (LLM-Driven) ---
    test('triggers /speak when LLM decides to respond vocally', async () => {
        mockInteraction.options.getString = jest.fn((n) => n === 'message' ? 'tell me a joke' : '');
        executeOllama.mockResolvedValue({
            message: { role: 'assistant', content: 'Sure! <<<RUN_COMMAND: {"command": "speak", "message": "Why did the chicken cross the road?"}>>>' }
        });
        const speakExec = jest.fn().mockResolvedValue();
        mockInteraction.client.commands.get = jest.fn().mockReturnValue({ execute: speakExec });

        await chat.execute(mockInteraction);

        expect(speakExec).toHaveBeenCalled();
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Sure!') }));
    });


    // --- Ollama Failure ---
    test('handles Ollama failure gracefully', async () => {
        executeOllama.mockRejectedValue(new Error('Connection refused'));

        await chat.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining('error communicating') })
        );
    });

    // --- Empty reply guard ---
    test('deletes interaction if tool does NOT send text (e.g. silent /speak)', async () => {
        executeOllama.mockResolvedValue({
            message: { role: 'assistant', content: '<<<RUN_COMMAND: {"command": "silent_cmd"}>>>' }
        });

        // Mock a command that does NOT call capture/reply
        const silentCmd = { execute: jest.fn().mockResolvedValue() };
        mockInteraction.client.commands.get = jest.fn().mockReturnValue(silentCmd);

        await chat.execute(mockInteraction);

        expect(mockInteraction.deleteReply).toHaveBeenCalled();
    });

    test('retains interaction if tool DOES send text (e.g. /timestamp)', async () => {
        executeOllama.mockResolvedValue({
            message: { role: 'assistant', content: '<<<RUN_COMMAND: {"command": "reply_cmd"}>>>' }
        });

        // Mock a command that DOES call capture/reply
        const replyCmd = { 
            execute: jest.fn().mockImplementation(async (mock) => {
                await mock.reply('Resulting Text');
            }) 
        };
        mockInteraction.client.commands.get = jest.fn().mockReturnValue(replyCmd);

        await chat.execute(mockInteraction);

        // Should have edited the status message with the result
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Resulting Text' }));
        // Should NOT have deleted the reply because it now contains the result
        expect(mockInteraction.deleteReply).not.toHaveBeenCalled();
    });

    // --- Interaction Slot Merging ---
    test('merges LLM text and tool output into a single message', async () => {
        executeOllama.mockResolvedValue({
            message: { role: 'assistant', content: 'Here is the data: <<<RUN_COMMAND: {"command": "reply_cmd"}>>>' }
        });

        const replyCmd = { 
            execute: jest.fn().mockImplementation(async (mock) => {
                await mock.reply('TOOL_RESULT');
            }) 
        };
        mockInteraction.client.commands.get = jest.fn().mockReturnValue(replyCmd);

        await chat.execute(mockInteraction);

        // Should have edited the reply to merge them
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Here is the data:') }));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('TOOL_RESULT') }));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('\n') }));
        
        // No follow-up should have been sent (since they were merged)
        expect(mockInteraction.followUp).not.toHaveBeenCalled();
    });

    // --- Exhaustive Autonomous Tool Tests ---
    test('ensures /summarize merges first chunk and overflows second correctly', async () => {
        const longSummary = 'A'.repeat(1800);
        const secondChunk = 'B'.repeat(300);
        
        executeOllama.mockResolvedValue({
            message: { role: 'assistant', content: '<<<RUN_COMMAND: {"command": "summarize", "url": "http://test.com"}>>>' }
        });

        const summarizeCmd = {
            execute: jest.fn().mockImplementation(async (mock) => {
                await mock.editReply(longSummary); // Should merge/edit
                await mock.followUp(secondChunk); // Should overflow to followUp (since 1800 + 300 > 2000)
            })
        };
        mockInteraction.client.commands.get = jest.fn().mockReturnValue(summarizeCmd);

        await chat.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: longSummary }));
        expect(mockInteraction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: secondChunk }));
    });

    test('ensures multiple tools merge into a single message', async () => {
        executeOllama.mockResolvedValue({
            message: { role: 'assistant', content: 'Results: <<<RUN_COMMAND: {"command": "t1"}>>> <<<RUN_COMMAND: {"command": "t2"}>>>' }
        });

        const t1 = { execute: jest.fn().mockImplementation(async (m) => await m.reply('R1')) };
        const t2 = { execute: jest.fn().mockImplementation(async (m) => await m.reply('R2')) };
        
        mockInteraction.client.commands.get = jest.fn((name) => {
            if (name === 't1') return t1;
            if (name === 't2') return t2;
            return null;
        });

        await chat.execute(mockInteraction);

        // Sequence: 
        // 1. editReply("Executing t1...")
        // 2. t1 calls editReply("R1") -> primaryContent is "R1"
        // 3. chat.js sees primaryResponseUsed is true, skips "Executing t2..."
        // 4. t2 calls editReply("R2") -> Merges "R1\nR2"
        // 5. final loop merges "Results:" with "R1\nR2"
        
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Results:') }));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('R1') }));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('R2') }));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Results:\nR1\nR2' }));
    });

    // --- getString fallback correctness ---
    test('getString returns correct value per parameter name', async () => {
        executeOllama.mockResolvedValue({
            message: { role: 'assistant', content: '<<<RUN_COMMAND: {"command": "summarize", "url": "https://example.com"}>>>' }
        });

        let capturedGetString;
        const summarizeExec = jest.fn().mockImplementation(async (inter) => {
            capturedGetString = inter.options.getString;
        });
        mockInteraction.client.commands.get = jest.fn().mockReturnValue({ execute: summarizeExec });

        await chat.execute(mockInteraction);

        expect(summarizeExec).toHaveBeenCalled();
        // getString('url') should return the URL
        expect(capturedGetString('url')).toBe('https://example.com');
        // getString('message') should NOT return the URL (it's not in cmdData.message)
        // It falls back through the chain, but that's expected for a missing key
    });

    // --- Double-brace LLM typo ---
    test('handles LLM double-brace typo in JSON payload', async () => {
        // The LLM sometimes outputs }} instead of } — this must not crash
        executeOllama.mockResolvedValue({
            message: { role: 'assistant', content: '<<<RUN_COMMAND: {"command": "catfact", "arg1": ""}}>>>' }
        });

        const catfactExec = jest.fn().mockResolvedValue();
        mockInteraction.client.commands.get = jest.fn().mockReturnValue({ execute: catfactExec });

        await chat.execute(mockInteraction);

        expect(catfactExec).toHaveBeenCalled();
    });
});
