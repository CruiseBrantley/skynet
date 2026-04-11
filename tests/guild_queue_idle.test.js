/**
 * Tests for GuildQueue's Idle handler currentTrack-preservation behaviour.
 *
 * Must live in its own file so jest.mock() hoisting works correctly for
 * @discordjs/voice and playVideo without colliding with the MusicManager mocks.
 */

const EventEmitter = require('events');

// Shared mock player instance — created once, reused across all GuildQueue instances
// via the mocked createAudioPlayer factory.
const mockPlayer = new EventEmitter();
mockPlayer.state = { status: 'idle' };
mockPlayer.stop = jest.fn();
mockPlayer.play = jest.fn();
mockPlayer.pause = jest.fn();
mockPlayer.unpause = jest.fn();

jest.mock('@discordjs/voice', () => ({
    createAudioPlayer: jest.fn(() => mockPlayer),
    joinVoiceChannel: jest.fn(),
    AudioPlayerStatus: {
        Idle: 'idle',
        Playing: 'playing',
        Paused: 'paused',
        Buffering: 'buffering',
    },
}));

jest.mock('../util/playVideo', () => {
    const fn = jest.fn();
    fn.extractVideoId = jest.fn().mockReturnValue(null); // skip file cleanup
    fn.downloadVideo = jest.fn().mockResolvedValue('/tmp/fake.opus');
    return fn;
});

jest.mock('../util/YouTubeMetadata', () => ({
    extractVideoId: jest.fn().mockReturnValue(null),
    getVideoInfo: jest.fn().mockResolvedValue({}),
    cache: { get: jest.fn() },
    getRecommendation: jest.fn(),
}));

jest.mock('../logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

const { AudioPlayerStatus } = require('@discordjs/voice');
const GuildQueue = require('../util/GuildQueue');

function makeGQ() {
    return new GuildQueue('test-guild', jest.fn());
}

// ---------------------------------------------------------------------------
// Suite: GuildQueue currentTrack preservation on Idle
// ---------------------------------------------------------------------------

describe('GuildQueue currentTrack preservation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPlayer.removeAllListeners();
        // Re-attach fresh listeners — each makeGQ() call re-registers them
    });

    test('currentTrack is preserved when queue empties and autoplay is off', () => {
        const gq = makeGQ();
        gq.autoplay = false;
        gq.queue = [];
        gq.currentTrack = { title: 'Last Song', url: 'https://yt/last' };
        gq.onQueueEnd = jest.fn();

        gq.player.emit(AudioPlayerStatus.Idle);

        expect(gq.currentTrack).not.toBeNull();
        expect(gq.currentTrack.title).toBe('Last Song');
        expect(gq.onQueueEnd).toHaveBeenCalledTimes(1);
    });

    test('position is reset to 0 even when currentTrack is preserved', () => {
        const gq = makeGQ();
        gq.autoplay = false;
        gq.queue = [];
        gq.currentTrack = { title: 'Last Song', url: 'https://yt/last' };
        // Simulate mid-song position
        gq._playbackStartedAt = Date.now() - 120_000;
        gq._seekOffsetMs = 0;
        gq.onQueueEnd = jest.fn();

        gq.player.emit(AudioPlayerStatus.Idle);

        expect(gq.getPositionSeconds()).toBe(0);
    });

    test('currentTrack is cleared and onQueueEnd NOT called when queue has more tracks', () => {
        const gq = makeGQ();
        gq.autoplay = false;
        gq.queue = [{ title: 'Next Song', url: 'https://yt/next' }];
        gq.currentTrack = { title: 'Current Song', url: 'https://yt/current' };
        gq.onQueueEnd = jest.fn();

        gq.player.emit(AudioPlayerStatus.Idle);

        // Queue advancement path: currentTrack nulled before _playNext, onQueueEnd never fires
        expect(gq.onQueueEnd).not.toHaveBeenCalled();
    });

    test('currentTrack is cleared when autoplay is enabled (autoplay will fill the queue)', () => {
        const gq = makeGQ();
        gq.autoplay = true;
        gq.queue = [];
        gq.currentTrack = { title: 'Last Song', url: 'https://yt/last' };
        gq.lastPlayedTrack = gq.currentTrack;
        gq.onAutoplayTrigger = jest.fn().mockResolvedValue();

        gq.player.emit(AudioPlayerStatus.Idle);

        // Autoplay path clears currentTrack immediately so _playNext can fill it
        expect(gq.currentTrack).toBeNull();
        expect(gq.onAutoplayTrigger).toHaveBeenCalled();
    });

    test('onQueueEnd is not called when autoplay is enabled (autoplay handles continuation)', () => {
        const gq = makeGQ();
        gq.autoplay = true;
        gq.queue = [];
        gq.currentTrack = { title: 'Last Song', url: 'https://yt/last' };
        gq.lastPlayedTrack = gq.currentTrack;
        gq.onQueueEnd = jest.fn();
        gq.onAutoplayTrigger = jest.fn().mockResolvedValue();

        gq.player.emit(AudioPlayerStatus.Idle);

        expect(gq.onQueueEnd).not.toHaveBeenCalled();
    });
});
