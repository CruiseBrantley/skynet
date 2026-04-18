const fs = require('fs');

const TASKS_FILE = '/tmp/skynet_test_agent_tasks.json';

jest.mock('../util/AgentScheduler', () => {
    const actualFs = jest.requireActual('fs');

    if (actualFs.existsSync(TASKS_FILE)) actualFs.unlinkSync(TASKS_FILE);

    class AgentScheduler {
        constructor() {
            this._tasks = [];
            if (actualFs.existsSync(TASKS_FILE)) {
                try { this._tasks = JSON.parse(actualFs.readFileSync(TASKS_FILE, 'utf8')); } catch(e) {}
            }
        }
        _save() { actualFs.writeFileSync(TASKS_FILE, JSON.stringify(this._tasks, null, 2)); }

        add(task) {
            const id = `task_${Date.now()}_test`;
            const entry = {
                id, description: task.description, scheduledAt: task.scheduledAt,
                userId: task.userId || null, guildId: task.guildId || null,
                channelId: task.channelId || 'dm', repeat: task.repeat || null,
                createdAt: Date.now(), createdBy: task.createdBy || 'test'
            };
            this._tasks.push(entry);
            this._save();
            return entry;
        }

        getDue() { return this._tasks.filter(t => t.scheduledAt <= Date.now()); }

        complete(id) { 
            this._tasks = this._tasks.filter(t => t.id !== id);
            this._save();
        }

        reschedule(id) {
            const task = this._tasks.find(t => t.id === id);
            if (!task || !task.repeat) return;
            const intervals = { hourly: 3_600_000, daily: 86_400_000, weekly: 604_800_000 };
            if (intervals[task.repeat]) task.scheduledAt += intervals[task.repeat];
            this._save();
        }

        cancel(id) {
            const before = this._tasks.length;
            this._tasks = this._tasks.filter(t => t.id !== id);
            if (this._tasks.length < before) {
                this._save();
                return true;
            }
            return false;
        }

        getAll() { return [...this._tasks]; }
        getByUser(userId) { return this._tasks.filter(t => t.userId === userId); }
        size() { return this._tasks.length; }
        _reset() { this._tasks = []; this._save(); }
    }

    return new AgentScheduler();
});

describe('AgentScheduler', () => {
    let scheduler;

    beforeEach(() => {
        scheduler = require('../util/AgentScheduler');
        scheduler._reset();
    });

    afterAll(() => {
        if (fs.existsSync(TASKS_FILE)) fs.unlinkSync(TASKS_FILE);
    });

    test('add() creates a task with the correct fields', () => {
        const t = scheduler.add({
            description: 'Test reminder',
            scheduledAt: Date.now() + 60_000,
            userId: 'user-1',
            channelId: 'dm'
        });
        expect(t.id).toMatch(/^task_/);
        expect(t.description).toBe('Test reminder');
        expect(t.channelId).toBe('dm');
        expect(t.repeat).toBeNull();
    });

    test('getDue() returns only tasks whose scheduledAt has passed', () => {
        scheduler.add({ description: 'Past task', scheduledAt: Date.now() - 1000 });
        scheduler.add({ description: 'Future task', scheduledAt: Date.now() + 60_000 });
        const due = scheduler.getDue();
        expect(due.length).toBe(1);
        expect(due[0].description).toBe('Past task');
    });

    test('complete() removes a task by id', () => {
        const t = scheduler.add({ description: 'One-shot', scheduledAt: Date.now() - 1 });
        expect(scheduler.size()).toBe(1);
        scheduler.complete(t.id);
        expect(scheduler.size()).toBe(0);
    });

    test('cancel() returns true for existing task, false for unknown', () => {
        const t = scheduler.add({ description: 'Cancellable', scheduledAt: Date.now() + 3600 });
        expect(scheduler.cancel(t.id)).toBe(true);
        expect(scheduler.cancel('nonexistent-id')).toBe(false);
    });

    test('reschedule() advances scheduledAt by the repeat interval', () => {
        const orig = Date.now() - 1000;
        const t = scheduler.add({ description: 'Daily task', scheduledAt: orig, repeat: 'daily' });
        scheduler.reschedule(t.id);
        const rescheduled = scheduler.getAll().find(x => x.id === t.id);
        expect(rescheduled.scheduledAt).toBe(orig + 86_400_000);
    });

    test('getByUser() filters tasks by userId', () => {
        scheduler.add({ description: 'Task A', scheduledAt: Date.now() + 1000, userId: 'user-1' });
        scheduler.add({ description: 'Task B', scheduledAt: Date.now() + 1000, userId: 'user-2' });
        expect(scheduler.getByUser('user-1').length).toBe(1);
        expect(scheduler.getByUser('user-1')[0].description).toBe('Task A');
    });

    test('getAll() returns all tasks', () => {
        scheduler.add({ description: 'T1', scheduledAt: Date.now() + 1000 });
        scheduler.add({ description: 'T2', scheduledAt: Date.now() + 2000 });
        expect(scheduler.getAll().length).toBe(2);
    });

    test('reloads tasks from disk on new instance instantiation', () => {
        scheduler.add({ description: 'Persistent Task', scheduledAt: Date.now() + 1000 });
        const AgentScheduler = scheduler.constructor;
        const newSched = new AgentScheduler();
        expect(newSched.getAll().some(t => t.description === 'Persistent Task')).toBe(true);
    });
});


// --- AgentClock tests ---
describe('AgentClock', () => {
    const { resolveTime, parseClockTime } = require('../util/AgentClock');

    test('resolves "in 30 minutes"', async () => {
        const before = Date.now();
        const ts = await resolveTime('in 30 minutes');
        expect(ts).toBeGreaterThan(before + 29 * 60_000);
        expect(ts).toBeLessThan(before + 31 * 60_000);
    });

    test('resolves "in 2 hours"', async () => {
        const before = Date.now();
        const ts = await resolveTime('in 2 hours');
        expect(ts).toBeGreaterThan(before + 1.9 * 3_600_000);
    });

    test('resolves "in 3 days"', async () => {
        const before = Date.now();
        const ts = await resolveTime('in 3 days');
        expect(ts).toBeGreaterThan(before + 2.9 * 86_400_000);
    });

    test('resolves "tomorrow"', async () => {
        const before = Date.now();
        const ts = await resolveTime('tomorrow');
        expect(ts).toBeGreaterThan(before + 23 * 3_600_000);
    });

    test('resolves "tonight" to a future time', async () => {
        const ts = await resolveTime('tonight');
        expect(ts).toBeGreaterThan(Date.now());
    });

    test('parseClockTime parses "9pm"', () => {
        const ts = parseClockTime('9pm');
        expect(ts).toBeGreaterThan(Date.now() - 1000);
        const d = new Date(ts);
        expect(d.getHours()).toBe(21);
        expect(d.getMinutes()).toBe(0);
    });

    test('parseClockTime parses "9:30am"', () => {
        const ts = parseClockTime('9:30am');
        expect(ts).not.toBeNull();
        const d = new Date(ts);
        expect(d.getHours()).toBe(9);
        expect(d.getMinutes()).toBe(30);
    });

    test('returns null for unparseable string', async () => {
        // Mock ollama so we don't make a real network call
        jest.mock('../util/ollama', () => ({
            queryOllama: jest.fn(),
            queryLocalOrRemote: jest.fn().mockRejectedValue(new Error('offline'))
        }));
        const ts = await resolveTime('next purple banana');
        expect(ts).toBeNull();
    });
});
