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

describe('MusicManager Autoplay UI tick', () => {
    let mockMessage;
    let mockChannel;
    
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        
        mockMessage = {
            edit: jest.fn().mockResolvedValue(),
            delete: jest.fn().mockResolvedValue(),
            createMessageComponentCollector: jest.fn().mockReturnValue({ on: jest.fn() })
        };

        mockChannel = {
            send: jest.fn().mockResolvedValue(mockMessage)
        };
    });

    afterEach(() => {
        jest.useRealTimers();
        if (manager.uiStates.has('guild-1')) {
            const state = manager.uiStates.get('guild-1');
            if (state && state.interval) clearInterval(state.interval);
            manager.uiStates.delete('guild-1');
        }
    });

    test('instant autoplay preload triggers when queue is empty and autoplay is enabled', async () => {
        const mockQueue = {
            guildId: 'guild-1',
            autoplay: true,
            queue: [],
            currentTrack: { title: 'Test Song', durationSeconds: 200 },
            isAutoplayFetching: false,
            getPositionSeconds: () => 5,
            onAutoplayTrigger: jest.fn().mockResolvedValue(),
            isPaused: () => false,
            history: new Set()
        };
        
        manager.getQueue = jest.fn().mockReturnValue(mockQueue);

        manager.startUIUpdate('guild-1', mockMessage, mockChannel);

        jest.advanceTimersByTime(5000);

        expect(mockQueue.isAutoplayFetching).toBe(true);
        expect(mockQueue.onAutoplayTrigger).toHaveBeenCalledWith(mockQueue.currentTrack, mockQueue.history);
        expect(mockMessage.edit).toHaveBeenCalled();
    });
    
    test('does not trigger autoplay preload if already fetching', async () => {
        const mockQueue = {
            guildId: 'guild-1',
            autoplay: true,
            queue: [],
            currentTrack: { title: 'Test Song', durationSeconds: 200 },
            isAutoplayFetching: true,
            getPositionSeconds: () => 5,
            onAutoplayTrigger: jest.fn().mockResolvedValue(),
            isPaused: () => false,
            history: new Set()
        };
        
        manager.getQueue = jest.fn().mockReturnValue(mockQueue);
        manager.startUIUpdate('guild-1', mockMessage, mockChannel);

        jest.advanceTimersByTime(5000);

        expect(mockQueue.onAutoplayTrigger).not.toHaveBeenCalled();
    });

    test('advances UI when a new track starts', async () => {
        const mockQueue = {
            guildId: 'guild-1',
            autoplay: false,
            queue: [],
            currentTrack: { title: 'New Track' },
            isPaused: () => false
        };
        manager.getQueue = jest.fn().mockReturnValue(mockQueue);

        // Setup existing state
        manager.startUIUpdate('guild-1', mockMessage, mockChannel);
        
        // Trigger advancement manually (mimics onTrackStart)
        await manager._handleTrackStart('guild-1', { title: 'New Track' });

        // Should have deleted old message
        expect(mockMessage.delete).toHaveBeenCalled();
        // Should have sent new message to the channel
        expect(mockChannel.send).toHaveBeenCalled();
        // Should have restarted the ticker (verified by checking if interval exists)
        expect(manager.uiStates.get('guild-1')).toBeDefined();
    });
});
