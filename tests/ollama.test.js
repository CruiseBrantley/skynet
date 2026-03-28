// Mock dependencies
jest.mock('axios');
jest.mock('child_process', () => ({
    exec: jest.fn()
}));
jest.mock('../logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

const axios = require('axios');
const { queryOllama } = require('../util/ollama');
const { exec } = require('child_process');
const logger = require('../logger');

describe('Ollama Utility Fallback Logic', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.GEMINI_API_KEY;
    });

    // --- Fallback Level 0 (Primary PC) ---
    test('routes to Level 0 (Primary) when online', async () => {
        axios.get.mockResolvedValueOnce({ data: {} }); 
        axios.post.mockResolvedValueOnce({ data: { response: 'Primary Response' } });

        const result = await queryOllama('/api/generate', { prompt: 'Hello' });

        expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('192.168.50.182'), expect.any(Object));
        expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('192.168.50.182'), expect.any(Object), expect.any(Object));
        expect(result).toEqual({ response: 'Primary Response' });
    });

    test('falls back to Level 1 (Gemini) if Level 0 is offline', async () => {
        process.env.GEMINI_API_KEY = 'mock_key';
        axios.get.mockRejectedValueOnce(new Error('Network Error'));
        axios.post.mockResolvedValueOnce({
            data: { choices: [{ message: { content: 'Gemini Response' } }] }
        });

        const result = await queryOllama('/api/generate', { prompt: 'Hello' }, 0);

        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Primary Ollama PC is offline'));
        expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('generativelanguage.googleapis'), expect.any(Object), expect.any(Object));
        expect(result).toEqual({ response: 'Gemini Response' });
    });

    // --- Fallback Level 1 (Gemini API) ---
    test('falls back to Level 2 (Local) if Gemini API key is missing', async () => {
        delete process.env.GEMINI_API_KEY;
        // Mock Level 2 (Local) success
        axios.get.mockResolvedValueOnce({ data: {} });
        axios.post.mockResolvedValueOnce({ data: { response: 'Local Fail-safe' } });

        const result = await queryOllama('/api/generate', { prompt: 'Hello' }, 1);

        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('GEMINI_API_KEY is not configured'));
        expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('127.0.0.1'), expect.any(Object), expect.any(Object));
        expect(result).toEqual({ response: 'Local Fail-safe' });
    });

    test('translates /api/chat payloads for Gemini correctly', async () => {
        process.env.GEMINI_API_KEY = 'mock_key';
        axios.post.mockResolvedValueOnce({
            data: { choices: [{ message: { content: 'Gemini Chat' } }] }
        });

        const messages = [{ role: 'user', content: 'Hi' }];
        const result = await queryOllama('/api/chat', { messages }, 1);

        expect(axios.post).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                messages: messages,
                model: 'gemini-1.5-flash'
            }),
            expect.any(Object)
        );
        expect(result).toEqual({ message: { role: 'assistant', content: 'Gemini Chat' } });
    });

    // --- Fallback Level 2 (Local Mac Mini) ---
    test('attempts to start Local Ollama if Level 2 is offline, then succeeds', async () => {
        axios.get.mockRejectedValueOnce(new Error('Offline')); // check 1
        axios.get.mockResolvedValueOnce({ data: {} });       // check 2 after start
        axios.post.mockResolvedValueOnce({ data: { response: 'Local Started' } });

        jest.useFakeTimers();
        const queryPromise = queryOllama('/api/generate', { prompt: 'Hello' }, 2);
        await jest.advanceTimersByTimeAsync(3000);
        const result = await queryPromise;

        expect(exec).toHaveBeenCalledWith('open -a Ollama');
        expect(result).toEqual({ response: 'Local Started' });
        jest.useRealTimers();
    });

    test('throws final error if Local Ollama cannot be started/reached', async () => {
        axios.get.mockRejectedValue(new Error('Offline')); // keep failing check
        
        jest.useFakeTimers();
        // Attach catch immediately to avoid "unhandled rejection" during timer advancement
        const queryPromise = queryOllama('/api/generate', { prompt: 'Hello' }, 2).catch(e => e);
        
        // Fast-forward all timers in the retry loop
        await jest.runAllTimersAsync();
        
        const error = await queryPromise;
        expect(error).toBeDefined();
        expect(error.message).toContain('All fallback tiers');
        jest.useRealTimers();
    });

    // --- Model Selection ---
    test('switches to vision-capable model if images are provided', async () => {
        axios.get.mockResolvedValueOnce({ data: {} }); 
        axios.post.mockResolvedValueOnce({ data: { response: 'Vision' } });

        await queryOllama('/api/chat', { 
            messages: [{ role: 'user', content: 'See', images: ['b64'] }] 
        }, 0);

        expect(axios.post).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ model: 'gemma3:27b' }),
            expect.any(Object)
        );
    });
});
