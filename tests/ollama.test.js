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

describe('queryLocalOrRemote — Gemini-free routing', () => {
    const { queryLocalOrRemote } = require('../util/ollama');
    let mockSocket;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.OLLAMA_REMOTE_HOST = 'remote-host';
        process.env.OLLAMA_REMOTE_PORT = '11434';
        process.env.OLLAMA_REMOTE_MODEL = 'remote-model';
        process.env.OLLAMA_LOCAL_MODEL = 'local-model';
        process.env.GEMINI_API_KEY = 'gemini-key';

        mockSocket = {
            setTimeout: jest.fn(),
            once: jest.fn(),
            connect: jest.fn((p, h, cb) => { if (cb) setImmediate(cb); }),
            end: jest.fn(),
            destroy: jest.fn()
        };
        net.Socket.mockImplementation(() => mockSocket);
    });

    test('calls remote PC when online — never Gemini', async () => {
        axios.post.mockResolvedValueOnce({ data: { message: { content: 'from-remote' } } });

        const result = await queryLocalOrRemote('/api/chat', { messages: [] });

        expect(result.message.content).toBe('from-remote');
        // Exactly one axios POST — to the remote PC, not Gemini
        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(axios.post.mock.calls[0][0]).toContain('remote-host');
        expect(axios.post.mock.calls[0][0]).not.toContain('googleapis');
    });

    test('falls back to local (level 2) when remote is offline — never Gemini', async () => {
        // Remote port check fails
        mockSocket.connect.mockImplementation((p, h, cb) => {
            if (p === 11434 && h === 'remote-host') return; // no callback = timeout
        });
        mockSocket.once.mockImplementation((event, cb) => {
            if (event === 'error' || event === 'timeout') setImmediate(cb);
        });

        // Local model responds
        axios.post.mockResolvedValueOnce({ data: { message: { content: 'from-local' } } });

        const result = await queryLocalOrRemote('/api/chat', { messages: [] });

        expect(result.message.content).toBe('from-local');
        // The local call should go to 127.0.0.1, not googleapis
        expect(axios.post.mock.calls[0][0]).not.toContain('googleapis');
    });

    test('falls back to local when remote throws — never Gemini', async () => {
        // Port check succeeds but POST fails
        axios.post
            .mockRejectedValueOnce(new Error('remote timeout'))
            .mockResolvedValueOnce({ data: { message: { content: 'local-fallback' } } });

        const result = await queryLocalOrRemote('/api/chat', { messages: [] });

        expect(result.message.content).toBe('local-fallback');
        // Gemini URL was never called
        const urls = axios.post.mock.calls.map(c => c[0]);
        expect(urls.some(u => u.includes('googleapis'))).toBe(false);
    });

    test('skips remote and goes straight to local when OLLAMA_REMOTE_HOST is missing', async () => {
        delete process.env.OLLAMA_REMOTE_HOST;
        axios.post.mockResolvedValueOnce({ data: { message: { content: 'local-only' } } });

        const result = await queryLocalOrRemote('/api/chat', { messages: [] });

        expect(result.message.content).toBe('local-only');
        // Any socket checks should be against localhost, never the remote host
        const connectCalls = mockSocket.connect.mock.calls;
        const remoteConnects = connectCalls.filter(([, host]) => host === 'remote-host');
        expect(remoteConnects.length).toBe(0);
    });
});
