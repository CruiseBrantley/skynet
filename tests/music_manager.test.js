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

    afterEach(cleanup);

    test('instant autoplay preload triggers when queue is empty and autoplay is enabled', async () => {
        const mockQueue = makeQueue({ autoplay: true });
        manager.getQueue = jest.fn().mockReturnValue(mockQueue);

        seedUIState(mockMessage, mockChannel);
        jest.advanceTimersByTime(5000);

        expect(mockQueue.isAutoplayFetching).toBe(true);
        expect(mockQueue.onAutoplayTrigger).toHaveBeenCalledWith(mockQueue.currentTrack, mockQueue.history);
        expect(mockMessage.edit).toHaveBeenCalled();
    });

    test('does not trigger autoplay preload if already fetching', async () => {
        const mockQueue = makeQueue({ autoplay: true, isAutoplayFetching: true });
        manager.getQueue = jest.fn().mockReturnValue(mockQueue);

        seedUIState(mockMessage, mockChannel);
        jest.advanceTimersByTime(5000);

        expect(mockQueue.onAutoplayTrigger).not.toHaveBeenCalled();
    });

    test('advances UI when a new track starts', async () => {
        const mockQueue = makeQueue({ currentTrack: { title: 'New Track' } });
        manager.getQueue = jest.fn().mockReturnValue(mockQueue);

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
        // Always return mockQueue from getQueue so the ticker never hits a null
        // branch and inadvertently creates an infinite stop/restart loop in tests.
        manager.getQueue = jest.fn().mockReturnValue(mockQueue);
        manager.queues.set('guild-1', mockQueue);
        seedUIState(mockMessage, mockChannel);
    });

    afterEach(cleanup);

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


