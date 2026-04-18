jest.mock('../util/AgentMemory', () => ({
    getSummary: jest.fn().mockReturnValue('user.cruise.tz = CST'),
    set: jest.fn(),
    delete: jest.fn(),
    get: jest.fn().mockReturnValue('CST')
}));

jest.mock('../util/AgentScheduler', () => ({
    getAll: jest.fn().mockReturnValue([]),
    add: jest.fn().mockReturnValue({ id: 'task_test_123', scheduledAt: Date.now() + 60_000 }),
    cancel: jest.fn().mockReturnValue(true)
}));

jest.mock('../util/AgentClock', () => ({
    resolveTime: jest.fn().mockResolvedValue(Date.now() + 3_600_000)
}));

jest.mock('../util/ollama', () => ({
    queryOllama: jest.fn(),
    queryLocalOrRemote: jest.fn()
}));

describe('AgentLoop', () => {
    let loop;
    let mockOllama;

    beforeEach(() => {
        jest.resetModules();
        // Re-apply mocks after resetModules
        jest.mock('../util/AgentMemory', () => ({
            getSummary: jest.fn().mockReturnValue('user.cruise.tz = CST'),
            set: jest.fn(),
            delete: jest.fn(),
            get: jest.fn().mockReturnValue('CST')
        }));
        jest.mock('../util/AgentScheduler', () => ({
            getAll: jest.fn().mockReturnValue([]),
            add: jest.fn().mockReturnValue({ id: 'task_test_123', scheduledAt: Date.now() + 60_000 }),
            cancel: jest.fn().mockReturnValue(true)
        }));
        jest.mock('../util/AgentClock', () => ({
            resolveTime: jest.fn().mockResolvedValue(Date.now() + 3_600_000)
        }));
        jest.mock('../util/ollama', () => ({
            queryOllama: jest.fn(),
            queryLocalOrRemote: jest.fn()
        }));
        jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }));

        loop = require('../util/AgentLoop');
        mockOllama = require('../util/ollama');
    });

    afterEach(() => {
        loop.stop();
    });

    test('NOOP response takes no action', async () => {
        mockOllama.queryLocalOrRemote.mockResolvedValue({
            message: { content: 'NOOP' }
        });

        await loop.runOnce();

        const mem = require('../util/AgentMemory');
        expect(mem.set).not.toHaveBeenCalled();
        expect(mem.delete).not.toHaveBeenCalled();
    });

    test('remember command updates agent memory', async () => {
        mockOllama.queryLocalOrRemote
            .mockResolvedValueOnce({
                message: { content: '<<<RUN_COMMAND: {"command": "remember", "key": "server.status", "value": "healthy", "ttl_days": 7}>>>\nReason: Recording health status.' }
            })
            .mockResolvedValueOnce({ message: { content: 'NOOP' } }); // recursion terminates

        await loop.runOnce();

        const mem = require('../util/AgentMemory');
        expect(mem.set).toHaveBeenCalledWith('server.status', 'healthy', 7, null);
    });

    test('forget command deletes a memory key', async () => {
        mockOllama.queryLocalOrRemote
            .mockResolvedValueOnce({
                message: { content: '<<<RUN_COMMAND: {"command": "forget", "key": "temp.stale_key"}>>>' }
            })
            .mockResolvedValueOnce({ message: { content: 'NOOP' } });

        await loop.runOnce();

        const mem = require('../util/AgentMemory');
        expect(mem.delete).toHaveBeenCalledWith('temp.stale_key');
    });

    test('schedule command creates a task', async () => {
        mockOllama.queryLocalOrRemote
            .mockResolvedValueOnce({
                message: { content: '<<<RUN_COMMAND: {"command": "schedule", "message": "Daily sync reminder", "when": "in 1 hour", "channelId": "dm"}>>>' }
            })
            .mockResolvedValueOnce({ message: { content: 'NOOP' } });

        await loop.runOnce();

        const sched = require('../util/AgentScheduler');
        expect(sched.add).toHaveBeenCalled();
    });

    test('cancel_task command cancels a scheduled task', async () => {
        mockOllama.queryLocalOrRemote
            .mockResolvedValueOnce({
                message: { content: '<<<RUN_COMMAND: {"command": "cancel_task", "id": "task_test_123"}>>>' }
            })
            .mockResolvedValueOnce({ message: { content: 'NOOP' } });

        await loop.runOnce();

        const sched = require('../util/AgentScheduler');
        expect(sched.cancel).toHaveBeenCalledWith('task_test_123');
    });

    test('unsupported command is silently ignored', async () => {
        mockOllama.queryLocalOrRemote
            .mockResolvedValueOnce({
                message: { content: '<<<RUN_COMMAND: {"command": "generate", "prompt": "draw a cat"}>>>' }
            })
            .mockResolvedValueOnce({ message: { content: 'NOOP' } });

        // Should not throw
        await expect(loop.runOnce()).resolves.toBeUndefined();
    });

    test('concurrent tick is skipped via isRunning guard', async () => {
        let resolveTick;
        mockOllama.queryLocalOrRemote.mockImplementation(() =>
            new Promise(resolve => { resolveTick = () => resolve({ message: { content: 'NOOP' } }); })
        );

        // Start first tick (won't complete until resolveTick is called)
        const first = loop.runOnce();
        // Immediately try a second tick
        await loop.runOnce(); // should skip

        resolveTick();
        await first;

        // Only one Ollama call should have happened (the second tick was skipped)
        expect(mockOllama.queryLocalOrRemote).toHaveBeenCalledTimes(1);
    });

    test('status exposes diagnostics correctly', async () => {
        mockOllama.queryLocalOrRemote.mockResolvedValue({ message: { content: 'NOOP' } });
        await loop.runOnce();

        const s = loop.status;
        expect(s.tickCount).toBeGreaterThanOrEqual(1);
        expect(s.lastRunAt).not.toBeNull();
        expect(Array.isArray(s.recentActions)).toBe(true);
    });

    test('loop depth guard prevents runaway recursion', async () => {
        // Always respond with the same command — should terminate at MAX_LOOP_DEPTH
        mockOllama.queryLocalOrRemote.mockResolvedValue({
            message: { content: '<<<RUN_COMMAND: {"command": "remember", "key": "loop.count", "value": "x", "ttl_days": 1}>>>' }
        });

        await loop.runOnce();

        const mem = require('../util/AgentMemory');
        // Should have been called at most MAX_LOOP_DEPTH + 1 times (depth 0-5)
        expect(mem.set.mock.calls.length).toBeLessThanOrEqual(7);
    });

    test('start() creates an interval and stop() clears it', () => {
        const bot = { user: { username: 'test' } };
        jest.useFakeTimers();
        const setIntervalSpy = jest.spyOn(global, 'setInterval');
        const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

        loop.start(bot, 1000);
        expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
        expect(loop.status.running).toBe(true);

        loop.stop();
        expect(clearIntervalSpy).toHaveBeenCalled();
        expect(loop.status.running).toBe(false);

        setIntervalSpy.mockRestore();
        clearIntervalSpy.mockRestore();
        jest.useRealTimers();
    });
});
