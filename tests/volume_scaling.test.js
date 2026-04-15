const GuildQueue = require('../util/GuildQueue');
const playVideo = require('../util/playVideo');
const { AudioPlayerStatus } = require('@discordjs/voice');

// Mock dependencies
jest.mock('@discordjs/voice', () => ({
    createAudioPlayer: jest.fn(() => ({
        on: jest.fn(),
        play: jest.fn(),
        state: { status: 'idle' }
    })),
    joinVoiceChannel: jest.fn(),
    AudioPlayerStatus: { Idle: 'idle', Playing: 'playing' }
}));

jest.mock('../util/playVideo', () => {
    const fn = jest.fn();
    fn.downloadVideo = jest.fn().mockResolvedValue('/tmp/fake.opus');
    fn.extractVideoId = jest.fn().mockReturnValue('fake-id');
    return fn;
});

jest.mock('../util/YouTubeMetadata', () => ({
    getVideoInfo: jest.fn().mockResolvedValue({ title: 'Fake Title', url: 'https://yt/fake' }),
    extractVideoId: jest.fn().mockReturnValue('fake-id'),
    cache: { get: jest.fn() }
}));

jest.mock('../logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
}));

describe('Volume Scaling', () => {
    let gq;

    beforeEach(() => {
        gq = new GuildQueue('test-guild', jest.fn());
    });

    test('default volume should be 1.0 (100% in user scale)', () => {
        expect(gq.volume).toBe(1.0);
    });

    test('setVolume should apply 0.25 scaling factor when playing', async () => {
        const mockResource = {
            volume: { setVolume: jest.fn() }
        };
        playVideo.mockResolvedValue(mockResource);

        gq.queue = [{ title: 'Track 1', url: 'https://yt/1' }];
        await gq._playNext();

        // 1.0 (internal/user volume) * 0.25 (scaling factor) = 0.25
        expect(mockResource.volume.setVolume).toHaveBeenCalledWith(0.25);
    });

    test('setVolume should apply 0.25 scaling factor when seeking', async () => {
        const mockResource = {
            volume: { setVolume: jest.fn() }
        };
        playVideo.mockResolvedValue(mockResource);
        gq.currentTrack = { title: 'Track 1', url: 'https://yt/1' };

        await gq.seek(30);

        // 1.0 (internal/user volume) * 0.25 (scaling factor) = 0.25
        expect(mockResource.volume.setVolume).toHaveBeenCalledWith(0.25);
    });
});
