const manager = require('./util/MusicManager');

const mockQueue = { 
    currentTrack: { title: 'Last Song', url: 'https://yt/last', durationSeconds: 240 },
    _resetPosition: () => console.log('RESET CALLED'),
    stop: () => console.log('STOP CALLED')
};
const mockMessage = { delete: () => console.log('DELETE CALLED') };

manager.queues.set('guild-1', mockQueue);
manager.uiStates.set('guild-1', {
    stageMessage: mockMessage,
    deleteTimer: null
});

console.log("Scheduling Idle Delete...");
manager._scheduleIdleDelete('guild-1');

// Mock jest.advanceTimersByTime by just awaiting the timeout or invoking the internal tracker
const state = manager.uiStates.get('guild-1');
const cb = state.deleteTimer._onTimeout;
console.log("Triggering Timeout...");
cb();
