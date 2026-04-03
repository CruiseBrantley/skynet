const { queryOllama } = require('../util/ollama');
const axios = require('axios');
const net = require('net');

jest.mock('axios');
jest.mock('net');
jest.mock('../logger');

jest.setTimeout(30000); // Increase timeout for the local startup retry loops

describe('Ollama Fallback Hierarchy (Level 0: Remote -> Level 1: Gemini -> Level 2: Local)', () => {
    let mockSocket;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSocket = {
            setTimeout: jest.fn(),
            once: jest.fn(),
            connect: jest.fn(),
            end: jest.fn(),
            destroy: jest.fn()
        };
        net.Socket.mockImplementation(() => mockSocket);
    });

    const mockPortOpen = (isOpen) => {
        mockSocket.connect.mockImplementation((port, host, cb) => {
            if (isOpen) cb();
        });
        if (!isOpen) {
            mockSocket.once.mockImplementation((event, cb) => {
                if (event === 'error' || event === 'timeout') cb();
            });
        }
    };

    test('should use Level 0 (Remote) when online', async () => {
        mockPortOpen(true);
        axios.post.mockResolvedValueOnce({ data: { message: { content: 'remote response' } } });

        const result = await queryOllama('/api/chat', { messages: [] });

        expect(result.message.content).toBe('remote response');
        expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('192.168.50.182'), expect.any(Object), expect.any(Object));
    });

    test('should failover to Level 1 (Gemini) when Remote is offline', async () => {
        mockPortOpen(false); // Remote offline
        process.env.GEMINI_API_KEY = 'test-key';

        // Mock Gemini success
        axios.post.mockResolvedValueOnce({ 
            data: { 
                choices: [{ message: { content: 'gemini response' } }] 
            } 
        });

        const result = await queryOllama('/api/chat', { messages: [] });

        expect(result.message.content).toBe('gemini response');
        expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('generativelanguage.googleapis.com'), expect.any(Object), expect.any(Object));
    });

    test('should failover to Level 2 (Local) when Remote and Gemini fail', async () => {
        mockPortOpen(false); // Remote offline
        process.env.GEMINI_API_KEY = 'test-key';

        // Gemini fails (Level 1)
        axios.post.mockRejectedValueOnce(new Error('Gemini API Error'));
        
        // Local online (Level 2)
        // Note: queryOllama checks port 11434 for local. We must handle the second checkPortOpen call.
        mockSocket.connect.mockImplementation((port, host, cb) => {
            if (port === 11434 && host === '127.0.0.1') cb(); // Local online
        });

        axios.post.mockResolvedValueOnce({ data: { message: { content: 'local response' } } });

        const result = await queryOllama('/api/chat', { messages: [] });

        expect(result.message.content).toBe('local response');
        expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('127.0.0.1:11434'), expect.objectContaining({ model: 'qwen3.5:4b' }), expect.any(Object));
    });

    test('should throw error if all tiers fail', async () => {
        mockPortOpen(false); // Remote offline
        process.env.GEMINI_API_KEY = 'test-key';

        axios.post.mockRejectedValueOnce(new Error('Gemini Fail')); // Level 1 fail
        
        // Local offline (Level 2)
        mockSocket.once.mockImplementation((event, cb) => {
            if (event === 'error') cb();
        });
        axios.post.mockRejectedValueOnce(new Error('Local Fail')); // Level 2 fail

        await expect(queryOllama('/api/chat', { messages: [] })).rejects.toThrow('All fallback tiers');
    });
});
