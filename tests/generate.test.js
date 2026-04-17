const generate = require('../commands/generate');
const axios = require('axios');
const logger = require('../logger');
const { queryOllama } = require('../util/ollama');
const { generateWithComfyDirect } = require('../util/comfy');
const { MessageFlags, AttachmentBuilder } = require('discord.js');

jest.mock('axios');
jest.mock('../logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
}));
jest.mock('../util/ollama', () => ({
    queryOllama: jest.fn(),
}));
jest.mock('../util/comfy', () => ({
    generateWithComfyDirect: jest.fn(),
}));

describe('imagine command', () => {
    let mockInteraction;
    
    beforeEach(() => {
        jest.clearAllMocks();
        
        process.env.IMAGE_MODEL_DEFAULT = 'Turbo';
        process.env.IMAGE_MODEL_FLUX = 'Flux';
        process.env.SWARMUI_REMOTE_URL = 'http://remote:7801';
        process.env.SWARMUI_LOCAL_URL = 'http://local:7801';
        
        mockInteraction = {
            user: { id: 'user1' },
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
            channel: { 
                sendTyping: jest.fn().mockResolvedValue(),
                send: jest.fn().mockResolvedValue(),
                messages: {
                    fetch: jest.fn().mockResolvedValue([{
                        attachments: {
                            size: 1,
                            first: () => ({ contentType: 'image/png', url: 'http://last-image.png' })
                        }
                    }])
                }
            },
            options: {
                getString: jest.fn().mockImplementation((name) => {
                    if (name === 'prompt') return 'A cute cat';
                    return null;
                }),
                getAttachment: jest.fn().mockReturnValue(null),
                getBoolean: jest.fn().mockReturnValue(false),
                getInteger: jest.fn().mockReturnValue(null),
            }
        };
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('metadata is correct', () => {
        expect(generate.data.name).toBe('imagine');
    });

    test('generates image successfully via SwarmUI', async () => {
        jest.useFakeTimers();
        
        // Mock Session
        axios.post.mockResolvedValueOnce({ data: { session_id: 'session-123' } });
        // Mock Generate
        axios.post.mockResolvedValueOnce({ data: { images: ['output/cat.png'] } });
        // Mock download
        axios.get.mockResolvedValueOnce({ data: Buffer.from('fake-image-data') });

        const promise = generate.execute(mockInteraction);
        
        // Let event loop run
        await Promise.resolve(); 
        jest.advanceTimersByTime(10000); // trigger typing interval

        await promise;

        expect(mockInteraction.deferReply).toHaveBeenCalled();
        expect(mockInteraction.channel.sendTyping).toHaveBeenCalled();
        
        expect(axios.post).toHaveBeenCalledWith('http://remote:7801/API/GetNewSession', expect.any(Object), expect.any(Object));
        expect(axios.post).toHaveBeenCalledWith('http://remote:7801/API/GenerateText2Image', expect.objectContaining({
            prompt: 'A cute cat',
            model: 'Turbo'
        }), expect.any(Object));
        expect(axios.get).toHaveBeenCalledWith('http://remote:7801/output/cat.png', expect.any(Object));

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
            content: '**Prompt:** *A cute cat*',
            files: [expect.any(AttachmentBuilder)],
            flags: [MessageFlags.SuppressEmbeds]
        });
    });

    test('handles enhance prompt with Ollama', async () => {
        mockInteraction.options.getBoolean.mockImplementation((name) => name === 'enhance_prompt');
        queryOllama.mockResolvedValueOnce({ response: 'A very cute highly detailed 4k cat' });
        
        axios.post.mockResolvedValueOnce({ data: { session_id: 'session-123' } });
        axios.post.mockResolvedValueOnce({ data: { images: ['output/cat.png'] } });
        axios.get.mockResolvedValueOnce({ data: Buffer.from('fake-image-data') });

        await generate.execute(mockInteraction);

        expect(queryOllama).toHaveBeenCalled();
        expect(axios.post).toHaveBeenCalledWith('http://remote:7801/API/GenerateText2Image', expect.objectContaining({
            prompt: 'A very cute highly detailed 4k cat'
        }), expect.any(Object));
        
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('**Enhanced:** *A very cute highly detailed 4k cat*')
        }));
    });

    test('handles fallback to comfy direct when local SwarmUI fails and model is Turbo', async () => {
        process.env.IMAGE_MODEL_DEFAULT = 'Turbo'; // Set model to Turbo to trigger direct comfy fallback
        
        // Remote fails
        axios.post.mockRejectedValueOnce(new Error('Remote offline'));
        
        generateWithComfyDirect.mockResolvedValueOnce(Buffer.from('comfy-data'));

        await generate.execute(mockInteraction);

        expect(generateWithComfyDirect).toHaveBeenCalledWith('A cute cat', expect.any(Object));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('✅ Local Fallback Image Generated')
        }));
    });

    test('handles init image via attachment', async () => {
        mockInteraction.options.getAttachment.mockReturnValue({
            contentType: 'image/png',
            url: 'http://explicit-image.png'
        });
        
        axios.get.mockResolvedValueOnce({ data: Buffer.from('image-content') }); // for init image
        
        axios.post.mockResolvedValueOnce({ data: { session_id: 'session-123' } });
        axios.post.mockResolvedValueOnce({ data: { images: ['output/cat.png'] } });
        axios.get.mockResolvedValueOnce({ data: Buffer.from('fake-image-data') }); // for result

        await generate.execute(mockInteraction);

        // Ensure GenerateText2Image payload has initimage
        expect(axios.post).toHaveBeenCalledWith('http://remote:7801/API/GenerateText2Image', expect.objectContaining({
            initimage: expect.stringContaining('data:image/png;base64,'), // checks that base64 padding is applied
            initimage_creativity: 0.6 // default
        }), expect.any(Object));
    });

    test('handles init image via use_last_image', async () => {
        mockInteraction.options.getBoolean.mockImplementation((name) => name === 'use_last_image');
        
        axios.get.mockResolvedValueOnce({ data: Buffer.from('last-image-content') }); // for init image
        
        axios.post.mockResolvedValueOnce({ data: { session_id: 'session-123' } });
        axios.post.mockResolvedValueOnce({ data: { images: ['output/cat.png'] } });
        axios.get.mockResolvedValueOnce({ data: Buffer.from('fake-image-data') }); // for result

        await generate.execute(mockInteraction);

        expect(mockInteraction.channel.messages.fetch).toHaveBeenCalledWith({ limit: 15 });
        expect(axios.get).toHaveBeenCalledWith('http://last-image.png', expect.any(Object));
    });

    test('handles errors and sends to channel if interaction timed out', async () => {
        axios.post.mockResolvedValueOnce({ data: { session_id: 'session-123' } });
        axios.post.mockResolvedValueOnce({ data: { images: ['output/cat.png'] } });
        axios.get.mockResolvedValueOnce({ data: Buffer.from('fake-image-data') });

        mockInteraction.editReply.mockRejectedValueOnce(new Error('Interaction timed out'));

        await generate.execute(mockInteraction);

        expect(mockInteraction.channel.send).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('A cute cat')
        }));
    });

    test('handles all nodes offline properly', async () => {
        axios.post.mockRejectedValueOnce(new Error('Remote offline')); // remote session
        process.env.IMAGE_MODEL_DEFAULT = 'Flux'; // non-turbo to prevent comfy direct fallback
        axios.post.mockRejectedValueOnce(new Error('Local offline')); // local session
        
        await generate.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining('Image Core offline'));
    });
    
    test('handles API returning empty images', async () => {
        axios.post.mockResolvedValueOnce({ data: { session_id: 'session-123' } });
        axios.post.mockResolvedValueOnce({ data: { images: [] } });

        await generate.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining('There was an error communicating'));
    });

    test('aspect ratios configure properly', async () => {
        mockInteraction.options.getString.mockImplementation((name) => {
            if (name === 'prompt') return 'A cute cat';
            if (name === 'aspect_ratio') return 'portrait';
            return null;
        });
        
        axios.post.mockResolvedValueOnce({ data: { session_id: 'session-123' } });
        axios.post.mockResolvedValueOnce({ data: { images: ['output/cat.png'] } });
        axios.get.mockResolvedValueOnce({ data: Buffer.from('fake-image-data') });

        await generate.execute(mockInteraction);

        expect(axios.post).toHaveBeenCalledWith('http://remote:7801/API/GenerateText2Image', expect.objectContaining({
            width: 1024,
            height: 1536
        }), expect.any(Object));
    });
});
