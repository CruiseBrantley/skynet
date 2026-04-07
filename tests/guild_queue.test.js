const { AudioPlayerStatus } = require('@discordjs/voice');
const GuildQueue = require('../util/GuildQueue');

jest.mock('../util/playVideo', () => {
    const fn = jest.fn().mockResolvedValue({ volume: { setVolume: jest.fn() } });
    fn.downloadVideo = jest.fn().mockResolvedValue('/tmp/music.opus');
    fn.analyzeLoudness = jest.fn().mockResolvedValue({ input_i: -10 });
    fn.extractVideoId = (url) => url.split('v=')[1];
    return fn;
});

jest.mock('../util/YouTubeMetadata', () => ({
    extractVideoId: (url) => url ? url.split('v=')[1] : null,
    getVideoInfo: jest.fn().mockResolvedValue({ title: 'Mocked Title' }),
    setLoudnormStats: jest.fn(),
    cache: { get: jest.fn(), has: jest.fn() }
}));

jest.mock('../logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
}));

describe('GuildQueue', () => {
    let queue;
    let mockPlayer;

    beforeEach(() => {
        jest.clearAllMocks();
        queue = new GuildQueue('guild-123');
        
        // Expose mock player directly for test manipulation
        mockPlayer = queue.player;
        mockPlayer.state = { status: AudioPlayerStatus.Idle };
        mockPlayer.pause = jest.fn();
        mockPlayer.unpause = jest.fn();
        mockPlayer.stop = jest.fn();
    });

    describe('shuffle', () => {
        test('shuffles the upcoming queue but leaves the current track untouched', () => {
            queue.queue = [
                { url: 'https://youtube.com/watch?v=1' },
                { url: 'https://youtube.com/watch?v=2' },
                { url: 'https://youtube.com/watch?v=3' },
                { url: 'https://youtube.com/watch?v=4' }
            ];
            
            queue._prefetchNext = jest.fn();
            queue.shuffle();
            
            // Should still have all items
            expect(queue.queue.length).toBe(4);
            expect(queue.queue.map(t => t.url)).toEqual(expect.arrayContaining([
                'https://youtube.com/watch?v=1',
                'https://youtube.com/watch?v=2',
                'https://youtube.com/watch?v=3',
                'https://youtube.com/watch?v=4'
            ]));
            expect(queue._prefetchNext).toHaveBeenCalled();
        });
        
        test('does nothing if 1 or 0 tracks exist', () => {
            queue.queue = [{ url: 'https://youtube.com/watch?v=1' }];
            queue._prefetchNext = jest.fn();
            queue.shuffle();
            expect(queue.queue.length).toBe(1);
            expect(queue._prefetchNext).not.toHaveBeenCalled();
        });
    });

    describe('pause and resume (Time tracking)', () => {
        beforeAll(() => {
            jest.useFakeTimers();
        });
        afterAll(() => {
            jest.useRealTimers();
        });

        test('correctly accounts for time spent paused without leaking elapsed time', () => {
            // Simulate start at T=0
            queue.player.state.status = AudioPlayerStatus.Playing;
            queue._playbackStartedAt = Date.now();
            
            // Advance by 5000ms (5s)
            jest.advanceTimersByTime(5000);
            
            expect(queue.getPositionSeconds()).toBe(5); // 5 seconds elapsed
            
            // Pause
            const pauseSuccess = queue.pause();
            expect(pauseSuccess).toBe(true);
            expect(queue._pausedAt).toBeDefined();
            
            // Advance by 10000ms (10s) while paused
            jest.advanceTimersByTime(10000);
            
            // Should STILL report 5 seconds because we are paused!
            expect(queue.getPositionSeconds()).toBe(5);
            
            // Resume
            queue.player.state.status = AudioPlayerStatus.Paused; // Must be Paused to resume
            const resumeSuccess = queue.resume();
            expect(resumeSuccess).toBe(true);
            
            // _playbackStartedAt should have jumped forward by 10s to offset the pause
            // Advance by another 2000ms (2s)
            jest.advanceTimersByTime(2000);
            
            expect(queue.getPositionSeconds()).toBe(7);
        });
    });

    describe('skip', () => {
        test('forces the audio player to stop even if paused', () => {
            queue.skip();
            expect(mockPlayer.stop).toHaveBeenCalledWith(true);
        });
    });

    describe('playback metadata enrichment', () => {
        test('refreshes currentTrack metadata from cache before emitting onTrackStart to capture yt-dlp native stats', async () => {
            const track = { url: 'https://youtube.com/watch?v=mock' };
            queue.queue = [track];
            const onTrackStartMock = jest.fn();
            queue.onTrackStart = onTrackStartMock;
            queue._prefetchNext = jest.fn();
            mockPlayer.play = jest.fn();
            
            // Mock cache to say some metadata was injected during playVideo
            const youtube = require('../util/YouTubeMetadata');
            youtube.cache.get.mockReturnValue({ durationSeconds: 42 });
            youtube.extractVideoId = jest.fn().mockReturnValueOnce('mock');
            
            await queue._playNext();
            
            // Since _playbackStartedAt is now set on Playing event, getPositionSeconds should be 0 here
            expect(queue.getPositionSeconds()).toBe(0);

            // Emit playing event
            queue.player.emit(AudioPlayerStatus.Playing);
            expect(queue.getPositionSeconds()).toBeGreaterThanOrEqual(0);

            expect(onTrackStartMock).toHaveBeenCalledWith(expect.objectContaining({
                url: 'https://youtube.com/watch?v=mock',
                durationSeconds: 42
            }));
        });
    });

    describe('autoplay triggering', () => {
        test('triggers autoplay only if not already fetching', async () => {
            queue.queue = [];
            queue.autoplay = true;
            queue.lastPlayedTrack = { title: 'Last Song' };
            const onAutoplayTriggerMock = jest.fn().mockReturnValue(new Promise(() => {})); // Never resolves for this test
            queue.onAutoplayTrigger = onAutoplayTriggerMock;
            
            await queue._playNext();
            
            expect(onAutoplayTriggerMock).toHaveBeenCalledTimes(1);
            expect(queue.isAutoplayFetching).toBe(true);
            
            // Try triggering again while isAutoplayFetching is true
            await queue._playNext();
            expect(onAutoplayTriggerMock).toHaveBeenCalledTimes(1); // Should still be 1
        });
    });

    describe('history context', () => {
        test('getRecentHistory combines past tracks and current track', () => {
            queue.recentTracks = [{ title: 'Past Song', channel: 'Artist' }];
            queue.currentTrack = { title: 'Now Playing', channel: 'DJ' };
            
            const history = queue.getRecentHistory();
            expect(history.length).toBe(2);
            expect(history[0].title).toBe('Past Song');
            expect(history[1].title).toBe('Now Playing');
        });

        test('recentTracks is capped at 5', () => {
            const track = { title: 'Song', channel: 'Artist' };
            for (let i = 0; i < 10; i++) {
                queue._addToRecentHistory(track);
            }
            expect(queue.recentTracks.length).toBe(5);
        });

        test('skipNext removes the next song and adds to history', () => {
            // First track becomes currentTrack
            queue.add({ url: 'https://youtube.com/watch?v=12345678901', title: 'Current', channel: 'Artist' });
            
            // Second track stays in queue
            const trackNext = { url: 'https://youtube.com/watch?v=ABCDEFGHIJK', title: 'Next Song', channel: 'Artist' };
            queue.add(trackNext);
            expect(queue.queue.length).toBe(1);

            const skipped = queue.skipNext();
            expect(skipped.title).toBe('Next Song');
            expect(queue.queue.length).toBe(0);
            expect(queue.history.has('ABCDEFGHIJK')).toBe(true);
            expect(queue.recentTracks[queue.recentTracks.length - 1].title).toBe('Next Song');
        });
    });
});
