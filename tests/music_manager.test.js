const client = {};

// Mock components
jest.mock('../util/MusicUI', () => ({
    buildFullDisplayState: jest.fn().mockReturnValue({
        content: '',
        embeds: [{}, {}],
        components: [{}, {}]
    }),
    normalizeThumbnail: jest.fn().mockImplementation(url => url),
}));
jest.mock('../util/playVideo', () => jest.fn());
jest.mock('../logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const manager = require('../util/MusicManager');
const musicUI = require('../util/MusicUI');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage() {
    return {
        edit: jest.fn().mockResolvedValue(),
        delete: jest.fn().mockResolvedValue(),
        createMessageComponentCollector: jest.fn().mockReturnValue({ on: jest.fn() }),
    };
}

function makeChannel(message) {
    return { send: jest.fn().mockResolvedValue(message) };
}

function makeQueue(overrides = {}) {
    return {
        guildId: 'guild-1',
        autoplay: false,
        queue: [],
        currentTrack: { title: 'Last Song', url: 'https://yt/last', durationSeconds: 240 },
        isAutoplayFetching: false,
        getPositionSeconds: () => 0,
        isPaused: () => false,
        history: new Set(),
        _resetPosition: jest.fn(),
        stop: jest.fn(),
        onAutoplayTrigger: jest.fn().mockResolvedValue(),
        ...overrides,
    };
}

function seedUIState(message, channel) {
    manager.startUIUpdate('guild-1', message, channel);
}

function cleanup() {
    jest.useRealTimers();
    const state = manager.uiStates.get('guild-1');
    if (state) {
        if (state.interval)    clearInterval(state.interval);
        if (state.deleteTimer) clearTimeout(state.deleteTimer);
        manager.uiStates.delete('guild-1');
    }
    manager.queues.delete('guild-1');
}

// ---------------------------------------------------------------------------
// Suite: Autoplay UI tick (existing behaviour)
// ---------------------------------------------------------------------------

describe('MusicManager Autoplay UI tick', () => {
    let mockMessage;
    let mockChannel;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        mockMessage = makeMessage();
        mockChannel = makeChannel(mockMessage);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        cleanup();
    });

    test('instant autoplay preload triggers when queue is empty and autoplay is enabled', async () => {
        const mockQueue = makeQueue({ autoplay: true });
        jest.spyOn(manager, 'getQueue').mockReturnValue(mockQueue);

        seedUIState(mockMessage, mockChannel);
        jest.advanceTimersByTime(5000);

        expect(mockQueue.isAutoplayFetching).toBe(true);
        expect(mockQueue.onAutoplayTrigger).toHaveBeenCalledWith(mockQueue.currentTrack, mockQueue.history);
        expect(mockMessage.edit).toHaveBeenCalled();
    });

    test('does not trigger autoplay preload if already fetching', async () => {
        const mockQueue = makeQueue({ autoplay: true, isAutoplayFetching: true });
        jest.spyOn(manager, 'getQueue').mockReturnValue(mockQueue);

        seedUIState(mockMessage, mockChannel);
        jest.advanceTimersByTime(5000);

        expect(mockQueue.onAutoplayTrigger).not.toHaveBeenCalled();
    });

    test('advances UI when a new track starts', async () => {
        const mockQueue = makeQueue({ currentTrack: { title: 'New Track' } });
        jest.spyOn(manager, 'getQueue').mockReturnValue(mockQueue);

        seedUIState(mockMessage, mockChannel);
        await manager._handleTrackStart('guild-1', { title: 'New Track' });

        expect(mockMessage.delete).toHaveBeenCalled();
        expect(mockChannel.send).toHaveBeenCalled();
        expect(manager.uiStates.get('guild-1')).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Suite: Idle-delete (queue ends naturally)
// ---------------------------------------------------------------------------

describe('MusicManager idle-delete window', () => {
    let mockMessage;
    let mockChannel;
    let mockQueue;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        mockMessage = makeMessage();
        mockChannel = makeChannel(mockMessage);
        mockQueue = makeQueue();
        jest.spyOn(manager, 'getQueue').mockReturnValue(mockQueue);
        manager.queues.set('guild-1', mockQueue);
        seedUIState(mockMessage, mockChannel);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        cleanup();
    });

    test('_scheduleIdleDelete does NOT delete the message immediately', () => {
        manager._scheduleIdleDelete('guild-1');

        // No delete right away
        expect(mockMessage.delete).not.toHaveBeenCalled();
        // Timer is armed
        expect(manager.uiStates.get('guild-1').deleteTimer).not.toBeNull();
    });

    test('currentTrack is preserved during the idle window', () => {
        manager._scheduleIdleDelete('guild-1');

        // The queue's currentTrack should still be intact
        expect(mockQueue.currentTrack).not.toBeNull();
        expect(mockQueue.currentTrack.title).toBe('Last Song');
    });

    test('the live ticker keeps running during the idle window', () => {
        manager._scheduleIdleDelete('guild-1');

        const state = manager.uiStates.get('guild-1');
        // Interval should still be alive (ticker was never stopped)
        expect(state.interval).not.toBeNull();
    });

    test('message is deleted and currentTrack nulled after 5 minutes', async () => {
        manager._scheduleIdleDelete('guild-1');

        // Stop the live ticker before advancing past 5 min — otherwise the repeating
        // 5-second interval would spin forever under fake timers.
        const state = manager.uiStates.get('guild-1');
        clearInterval(state.interval);
        state.interval = null;

        jest.advanceTimersByTime(5 * 60 * 1000 + 1);
        // Flush microtasks: the deleteTimer callback is async (awaits message.delete)
        // so we need multiple Promise ticks to let it fully settle.
        for (let i = 0; i < 5; i++) await Promise.resolve();

        expect(mockMessage.delete).toHaveBeenCalledTimes(1);
        expect(mockQueue.currentTrack).toBeNull();
        expect(mockQueue._resetPosition).toHaveBeenCalled();
        expect(manager.uiStates.has('guild-1')).toBe(false);
    });

    test('stop() deletes the message immediately, bypassing the 5-minute timer', async () => {
        manager._scheduleIdleDelete('guild-1');

        // Simulate stop command
        manager.stop('guild-1');

        expect(mockMessage.delete).toHaveBeenCalledTimes(1);
        // Advance well past 5 minutes — stop() should have cleared the timer
        // so no second delete fires. Stop the ticker first to avoid infinite loop.
        jest.advanceTimersByTime(5 * 60 * 1000 + 1);
        await Promise.resolve();
        expect(mockMessage.delete).toHaveBeenCalledTimes(1);
    });

    test('_cancelIdleDelete disarms the timer so message is never deleted', async () => {
        manager._scheduleIdleDelete('guild-1');

        manager._cancelIdleDelete('guild-1');

        // Stop the ticker then advance past 5 min — the delete timer was cancelled
        // so nothing should fire.
        const state = manager.uiStates.get('guild-1');
        clearInterval(state.interval);
        state.interval = null;

        jest.advanceTimersByTime(5 * 60 * 1000 + 1);
        await Promise.resolve();
        expect(mockMessage.delete).not.toHaveBeenCalled();
        // State is still alive (not torn down)
        expect(manager.uiStates.has('guild-1')).toBe(true);
    });

    test('_cancelIdleDelete is a no-op when no timer is pending', () => {
        // Should not throw
        expect(() => manager._cancelIdleDelete('guild-1')).not.toThrow();
        expect(() => manager._cancelIdleDelete('guild-nonexistent')).not.toThrow();
    });

    test('restarting the song resets the 5-minute timer, not just cancels it', async () => {
        manager._scheduleIdleDelete('guild-1');
        const firstTimer = manager.uiStates.get('guild-1').deleteTimer;

        // Simulate restart (song finishes again → _scheduleIdleDelete is called again)
        manager._scheduleIdleDelete('guild-1');
        const secondTimer = manager.uiStates.get('guild-1').deleteTimer;

        // A new timer should have replaced the old one
        expect(secondTimer).not.toBe(firstTimer);

        // Stop the ticker so advancing time doesn't spawn an infinite loop
        const state = manager.uiStates.get('guild-1');
        clearInterval(state.interval);
        state.interval = null;

        // Advance to just past the FIRST timer window — message should NOT be deleted yet
        jest.advanceTimersByTime(5 * 60 * 1000 - 1000);
        await Promise.resolve();
        expect(mockMessage.delete).not.toHaveBeenCalled();

        // Advance past the second timer — NOW it should delete
        jest.advanceTimersByTime(2000);
        await Promise.resolve();
        expect(mockMessage.delete).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// Suite: API Methods (enqueue, controls)
// ---------------------------------------------------------------------------

describe('MusicManager API and Controls', () => {
    let mockInteraction;
    let mockQueue;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        
        mockInteraction = {
            guildId: 'guild-1',
            member: { voice: { channelId: 'channel-1' } },
            guild: { voiceAdapterCreator: {}, channels: { cache: { get: jest.fn().mockReturnValue({}) } } },
            user: { username: 'test-user' }
        };

        mockQueue = makeQueue({
            join: jest.fn().mockResolvedValue(),
            add: jest.fn(),
            addBatch: jest.fn(),
            skip: jest.fn(),
            pause: jest.fn().mockReturnValue(true),
            resume: jest.fn().mockReturnValue(true),
            seek: jest.fn().mockResolvedValue(true),
            queue: [{ title: 'Track 2' }]
        });

        const GuildQueue = require('../util/GuildQueue');
        jest.spyOn(manager, 'getOrCreateQueue').mockReturnValue(mockQueue);
        manager.queues.set('guild-1', mockQueue);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        cleanup();
    });

    test('enqueue successfully joins and adds track', async () => {
        const track = { title: 'Track 1', url: 'http' };
        await manager.enqueue(mockInteraction, track);
        
        expect(manager.getOrCreateQueue).toHaveBeenCalledWith('guild-1', mockInteraction.guild.voiceAdapterCreator);
        expect(mockQueue.join).toHaveBeenCalled();
        expect(mockQueue.add).toHaveBeenCalledWith(track, mockInteraction.user);
    });

    test('enqueueBatch successfully joins and adds multiple tracks', async () => {
        const tracks = [{ title: 'Track 1', url: 'http' }, { title: 'Track 2' }];
        await manager.enqueueBatch(mockInteraction, tracks);
        
        expect(mockQueue.join).toHaveBeenCalled();
        expect(mockQueue.addBatch).toHaveBeenCalledWith(tracks, mockInteraction.user);
    });

    test('enqueue throws if user not in voice', async () => {
        mockInteraction.member.voice.channelId = null;
        await expect(manager.enqueue(mockInteraction, {})).rejects.toThrow('You need to be in a voice channel');
        await expect(manager.enqueueBatch(mockInteraction, [])).rejects.toThrow('You need to be in a voice channel');
    });

    test('skip calls queue.skip', () => {
        manager.skip('guild-1');
        expect(mockQueue.skip).toHaveBeenCalled();
    });

    test('pause and resume', () => {
        manager.pause('guild-1');
        expect(mockQueue.pause).toHaveBeenCalled();
        manager.resume('guild-1');
        expect(mockQueue.resume).toHaveBeenCalled();
    });

    test('nowPlaying and upcoming', () => {
        expect(manager.nowPlaying('guild-1').title).toBe('Last Song');
        expect(manager.getUpcoming('guild-1').length).toBe(1);
    });

    test('seek', async () => {
        await manager.seek('guild-1', 30);
        expect(mockQueue.seek).toHaveBeenCalledWith(30);
    });
});

// ---------------------------------------------------------------------------
// Suite: Interaction Handler (Buttons)
// ---------------------------------------------------------------------------

describe('MusicManager handleInteraction', () => {
    let mockBtn;
    let mockQueue;
    let mockMessage;
    let mockClient;

    beforeEach(() => {
        jest.clearAllMocks();
        
        mockClient = { user: { setActivity: jest.fn() } };
        mockBtn = {
            guildId: 'guild-1',
            customId: 'music_pause',
            deferUpdate: jest.fn().mockResolvedValue(),
            reply: jest.fn().mockResolvedValue(),
            deleteReply: jest.fn().mockResolvedValue(),
            client: mockClient
        };

        mockQueue = makeQueue({
            isPaused: jest.fn().mockReturnValue(false),
            isPlaying: jest.fn().mockReturnValue(true),
            pause: jest.fn(),
            resume: jest.fn(),
            skip: jest.fn(),
            skipNext: jest.fn().mockReturnValue({ title: 'Removed Track' }),
            restart: jest.fn().mockResolvedValue(),
            shuffle: jest.fn(),
            queue: [{ title: 'Track 2' }, { title: 'Track 3' }]
        });

        manager.queues.set('guild-1', mockQueue);

        mockMessage = makeMessage();
        seedUIState(mockMessage, makeChannel(mockMessage));
    });

    afterEach(cleanup);

    test('music_pause toggles pause logic', async () => {
        await manager.handleInteraction(mockBtn);
        expect(mockQueue.pause).toHaveBeenCalled();
        expect(mockBtn.deferUpdate).toHaveBeenCalled();

        mockQueue.isPaused.mockReturnValue(true);
        mockQueue.isPlaying.mockReturnValue(false);
        await manager.handleInteraction(mockBtn);
        expect(mockQueue.resume).toHaveBeenCalled();
    });

    test('music_skip skips current track', async () => {
        mockBtn.customId = 'music_skip';
        await manager.handleInteraction(mockBtn);
        expect(mockQueue.skip).toHaveBeenCalled();
        expect(mockBtn.deferUpdate).toHaveBeenCalled();
    });

    test('music_skip_next removes upcoming track', async () => {
        mockBtn.customId = 'music_skip_next';
        await manager.handleInteraction(mockBtn);
        expect(mockQueue.skipNext).toHaveBeenCalled();
        expect(mockBtn.deferUpdate).toHaveBeenCalled();
    });

    test('music_stop stops queue and resets activity', async () => {
        mockBtn.customId = 'music_stop';
        await manager.handleInteraction(mockBtn);
        expect(mockQueue.stop).toHaveBeenCalled();
        expect(mockClient.user.setActivity).toHaveBeenCalled();
        expect(manager.queues.has('guild-1')).toBe(false);
    });

    test('music_restart restarts track and cancels idle cleanup', async () => {
        mockBtn.customId = 'music_restart';
        const spyCancel = jest.spyOn(manager, '_cancelIdleDelete');
        await manager.handleInteraction(mockBtn);
        expect(mockQueue.restart).toHaveBeenCalled();
        expect(spyCancel).toHaveBeenCalledWith('guild-1');
        spyCancel.mockRestore();
    });

    test('music_shuffle shuffles the queue if tracks > 1', async () => {
        mockBtn.customId = 'music_shuffle';
        await manager.handleInteraction(mockBtn);
        expect(mockQueue.shuffle).toHaveBeenCalled();
        expect(mockBtn.deferUpdate).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Suite: Autoplay Triggering via YouTube
// ---------------------------------------------------------------------------

describe('MusicManager Autoplay integration', () => {
    let mockQueue;
    let mockMessage;
    
    beforeEach(() => {
        jest.clearAllMocks();
        mockQueue = makeQueue({
            add: jest.fn(),
            getRecentHistory: jest.fn().mockReturnValue([{ title: 'Song 1' }])
        });
        manager.queues.set('guild-1', mockQueue);
        
        mockMessage = makeMessage();
        seedUIState(mockMessage, makeChannel(mockMessage));
    });

    afterEach(cleanup);

    test('triggerAutoplay adds song if recommendation found', async () => {
        const youtube = require('../util/YouTubeMetadata');
        jest.spyOn(youtube, 'getRecommendation').mockResolvedValueOnce({ title: 'New Auto Track', url: 'http://auto' });

        await manager.triggerAutoplay('guild-1', { title: 'Last' }, new Set());

        expect(youtube.getRecommendation).toHaveBeenCalled();
        expect(mockQueue.add).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Auto Track' }), 'Skynet Autoplay');
    });

    test('triggerAutoplay stops UI update if no recommendation found', async () => {
        const youtube = require('../util/YouTubeMetadata');
        jest.spyOn(youtube, 'getRecommendation').mockResolvedValueOnce(null);
        
        const spyStopUI = jest.spyOn(manager, 'stopUIUpdate');

        await manager.triggerAutoplay('guild-1', { title: 'Last' }, new Set());

        expect(spyStopUI).toHaveBeenCalledWith('guild-1');
        spyStopUI.mockRestore();
    });
});
