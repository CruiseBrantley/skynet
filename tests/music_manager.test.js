const client = {};

// Mock components
jest.mock('../util/MusicUI', () => ({
    buildNowPlayingEmbed: jest.fn().mockReturnValue({ setColor: jest.fn().mockReturnThis(), setAuthor: jest.fn().mockReturnThis() }),
    buildControlRow: jest.fn().mockReturnValue([]),
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
    
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        mockMessage = {
            edit: jest.fn().mockResolvedValue(),
            createMessageComponentCollector: jest.fn().mockReturnValue({ on: jest.fn() })
        };
    });

    afterEach(() => {
        jest.useRealTimers();
        if (manager.uiStates.has('guild-1')) {
            clearInterval(manager.uiStates.get('guild-1').interval);
            manager.uiStates.delete('guild-1');
        }
    });

    test('instant autoplay preload triggers when queue is empty and autoplay is enabled', async () => {
        // Mock queue
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

        // Start UI interval
        manager.startUIUpdate('guild-1', mockMessage, {});

        // Fast-forward interval (5 seconds)
        jest.advanceTimersByTime(5000);

        // The UI should have ticked and checked the queue
        expect(mockQueue.isAutoplayFetching).toBe(true);
        expect(mockQueue.onAutoplayTrigger).toHaveBeenCalledWith(mockQueue.currentTrack, mockQueue.history);
        
        // Ensure UI update was also sent
        expect(mockMessage.edit).toHaveBeenCalled();
    });
    
    test('does not trigger autoplay preload if already fetching', async () => {
        const mockQueue = {
            guildId: 'guild-1',
            autoplay: true,
            queue: [],
            currentTrack: { title: 'Test Song', durationSeconds: 200 },
            isAutoplayFetching: true, // ALREADY FETCHING!
            getPositionSeconds: () => 5,
            onAutoplayTrigger: jest.fn().mockResolvedValue(),
            isPaused: () => false,
            history: new Set()
        };
        
        manager.getQueue = jest.fn().mockReturnValue(mockQueue);

        manager.startUIUpdate('guild-1', mockMessage, {});

        jest.advanceTimersByTime(5000);

        // Should NOT trigger again
        expect(mockQueue.onAutoplayTrigger).not.toHaveBeenCalled();
    });
});
