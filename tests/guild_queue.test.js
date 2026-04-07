const { AudioPlayerStatus } = require('@discordjs/voice');
const GuildQueue = require('../util/GuildQueue');

jest.mock('../util/playVideo', () => ({
    downloadVideo: jest.fn().mockResolvedValue('/tmp/music.opus'),
    analyzeLoudness: jest.fn().mockResolvedValue({ input_i: -10 }),
    extractVideoId: (url) => url.split('v=')[1],
}));

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
            
            // 5s played initially + 2s played after = 7 seconds
            expect(queue.getPositionSeconds()).toBe(7);
        });
    });
});
