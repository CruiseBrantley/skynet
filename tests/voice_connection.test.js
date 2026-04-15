const GuildQueue = require('../util/GuildQueue');
const { VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const logger = require('../logger');

// Mock dependencies
jest.mock('@discordjs/voice', () => ({
    createAudioPlayer: jest.fn(() => ({ on: jest.fn(), state: { status: 'idle' } })),
    joinVoiceChannel: jest.fn(() => ({
        subscribe: jest.fn(),
        destroy: jest.fn(),
        joinConfig: { channelId: '123' }
    })),
    entersState: jest.fn(),
    VoiceConnectionStatus: { Ready: 'ready' },
    AudioPlayerStatus: { Idle: 'idle' }
}));

jest.mock('../logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
}));

jest.mock('../util/playVideo', () => ({
    extractVideoId: jest.fn()
}));

describe('GuildQueue Voice Connection', () => {
    let gq;

    beforeEach(() => {
        jest.clearAllMocks();
        gq = new GuildQueue('test-guild', jest.fn());
    });

    test('join() should succeed when connection becomes Ready', async () => {
        entersState.mockResolvedValueOnce(); // Simulates reaching the Ready state

        const mockChannel = { id: '123', name: 'Test Channel', bitrate: 64000 };
        await gq.join(mockChannel);

        expect(entersState).toHaveBeenCalledWith(expect.anything(), 'ready', 20000);
        expect(gq.connection).not.toBeNull();
    });

    test('join() should throw and cleanup when connection times out', async () => {
        const timeoutErr = new Error('Timeout');
        entersState.mockRejectedValueOnce(timeoutErr);

        const mockChannel = { id: '123', name: 'Test Channel', bitrate: 64000 };
        
        await expect(gq.join(mockChannel)).rejects.toThrow('Failed to join voice channel Test Channel within 20 seconds');
        
        expect(gq.connection).toBeNull();
    });
});
