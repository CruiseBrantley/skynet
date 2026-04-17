const { queryOllama } = require('../util/ollama');
const axios = require('axios');
const net = require('net');

jest.mock('axios');
jest.mock('net');
jest.mock('../logger');

jest.setTimeout(30000);

describe('Ollama Fallback Hierarchy', () => {
    let mockSocket;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.OLLAMA_REMOTE_HOST = 'remote-host';
        process.env.OLLAMA_REMOTE_PORT = '11434';
        process.env.OLLAMA_REMOTE_MODEL = 'remote-model';
        process.env.OLLAMA_LOCAL_MODEL = 'local-model';
        process.env.GEMINI_API_KEY = 'gemini-key';
        process.env.GEMINI_MODEL = 'gemini-model';

        mockSocket = {
            setTimeout: jest.fn(),
            once: jest.fn(),
            connect: jest.fn((p, h, cb) => { if(cb) setImmediate(cb); }),
            end: jest.fn(),
            destroy: jest.fn()
        };
        net.Socket.mockImplementation(() => mockSocket);
    });

    test('should use Level 0 (Remote) when online', async () => {
        axios.post.mockResolvedValueOnce({ data: { message: { content: 'remote' } } });
        const result = await queryOllama('/api/chat', { messages: [] });
        expect(result.message.content).toBe('remote');
    });

    test('should failover to Level 1 (Gemini) when Remote is offline', async () => {
        // Mock remote port as closed
        mockSocket.connect.mockImplementation((p, h, cb) => {
            if (p === 11434 && h === 'remote-host') return; // fail
            if (cb) setImmediate(cb);
        });
        mockSocket.once.mockImplementation((event, cb) => {
            if (event === 'error' || event === 'timeout') setImmediate(cb);
        });

        axios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'gemini' } }] } });
        const result = await queryOllama('/api/chat', { messages: [] });
        expect(result.message.content).toBe('gemini');
    });

    test('should failover to Level 2 (Local) when Gemini fails', async () => {
        // Mock remote port as closed
        mockSocket.connect.mockImplementation((p, h, cb) => {
            if (p === 11434 && h === 'remote-host') return; // fail
            if (cb) setImmediate(cb);
        });
        mockSocket.once.mockImplementation((event, cb) => {
            if (event === 'error' || event === 'timeout') setImmediate(cb);
        });

        axios.post.mockRejectedValueOnce(new Error('Gemini error'));
        axios.post.mockResolvedValueOnce({ data: { message: { content: 'local' } } });

        const result = await queryOllama('/api/chat', { messages: [] });
        expect(result.message.content).toBe('local');
    });

    test('should skip Level 0 entirely if OLLAMA_REMOTE_HOST is missing', async () => {
        delete process.env.OLLAMA_REMOTE_HOST;
        axios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'gemini' } }] } });
        
        const result = await queryOllama('/api/chat', { messages: [] });
        
        expect(result.message.content).toBe('gemini');
        // Should NOT have attempted a port check for remote host that is undefined
        expect(net.Socket).not.toHaveBeenCalled(); 
    });
});
