/**
 * Integration tests for the new agent tool commands wired into chat.js:
 * remember, recall, forget, schedule, cancel_task, list_tasks
 *
 * Pattern mirrors chat_search.test.js: mock ollama + dependencies,
 * drive chat.execute(), assert the right agent methods were called.
 */
const { MessageFlags } = require('discord.js');

// ----- Mocks ----------------------------------------------------------------
jest.mock('../util/ollama');
jest.mock('../logger');
jest.mock('google-it', () => jest.fn().mockResolvedValue([]));
jest.mock('duck-duck-scrape', () => ({ search: jest.fn().mockResolvedValue({ results: [] }) }));
jest.mock('wikipedia', () => ({ summary: jest.fn(), setUserAgent: jest.fn() }));
jest.mock('../util/puppeteerSearch', () => ({ performSearch: jest.fn() }));
jest.mock('../util/summarize', () => ({ fetchPageText: jest.fn() }));

const mockMemorySet = jest.fn();
const mockMemoryGet = jest.fn();
const mockMemoryDelete = jest.fn();
const mockMemoryGetSummary = jest.fn().mockReturnValue(null);
jest.mock('../util/AgentMemory', () => ({
    set: mockMemorySet,
    get: mockMemoryGet,
    delete: mockMemoryDelete,
    getSummary: mockMemoryGetSummary
}));

const mockSchedulerAdd = jest.fn().mockReturnValue({ id: 'task_test_1', scheduledAt: Date.now() + 3_600_000 });
const mockSchedulerCancel = jest.fn().mockReturnValue(true);
const mockSchedulerGetByUser = jest.fn().mockReturnValue([]);
jest.mock('../util/AgentScheduler', () => ({
    add: mockSchedulerAdd,
    cancel: mockSchedulerCancel,
    getByUser: mockSchedulerGetByUser
}));

jest.mock('../util/AgentClock', () => ({
    resolveTime: jest.fn().mockResolvedValue(Date.now() + 3_600_000)
}));
// ---------------------------------------------------------------------------

const ollama = require('../util/ollama');
const chatCmd = require('../commands/chat');

const GUILD_ID = 'guild-test-123';

function makeInteraction(message = 'test') {
    return {
        id: 'interaction-1',
        user: { tag: 'cruise#0001', username: 'cruise', id: 'user-999' },
        client: {
            user: { id: 'bot-id-000' },
            commands: { map: jest.fn().mockReturnValue([]) }
        },
        guildId: GUILD_ID,
        channelId: 'channel-abc',
        options: {
            getString: jest.fn().mockImplementation((n) => n === 'message' ? message : null),
            getAttachment: jest.fn(),
            attachments: { size: 0 }
        },
        deferReply: jest.fn(),
        editReply: jest.fn(),
        followUp: jest.fn(),
        deleteReply: jest.fn(),
        channel: { send: jest.fn() }
    };
}

// Helper: mock ollama to emit a tool call, then NOOP on followup
function mockToolCall(toolCallContent) {
    ollama.queryOllama
        .mockResolvedValueOnce({ message: { role: 'assistant', content: toolCallContent } })
        .mockResolvedValueOnce({ message: { role: 'assistant', content: 'Got it!' } });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockMemoryGetSummary.mockReturnValue(null);
    mockSchedulerAdd.mockReturnValue({ id: 'task_test_1', scheduledAt: Date.now() + 3_600_000 });
});

// ─── remember ───────────────────────────────────────────────────────────────
describe('chat.js — remember command', () => {
    test('calls AgentMemory.set with correct key, value, ttl, and guildId', async () => {
        mockToolCall('<<<RUN_COMMAND: {"command": "remember", "key": "user.cruise.lang", "value": "English", "ttl_days": -1}>>>');

        await chatCmd.execute(makeInteraction('remember my language is English'));

        expect(mockMemorySet).toHaveBeenCalledWith('user.cruise.lang', 'English', -1, GUILD_ID);
    });

    test('defaults ttl_days to 30 when not provided', async () => {
        mockToolCall('<<<RUN_COMMAND: {"command": "remember", "key": "pref.style", "value": "concise"}>>>');

        await chatCmd.execute(makeInteraction('remember I like concise responses'));

        expect(mockMemorySet).toHaveBeenCalledWith('pref.style', 'concise', 30, GUILD_ID);
    });

    test('injects follow-up system message and calls ollama a second time', async () => {
        mockToolCall('<<<RUN_COMMAND: {"command": "remember", "key": "user.cruise.tz", "value": "CST", "ttl_days": -1}>>>');

        await chatCmd.execute(makeInteraction('I am in CST'));

        // First call: LLM emits the remember command
        // Second call: followup after memory is stored
        expect(ollama.queryOllama).toHaveBeenCalledTimes(2);

        // The second call's messages should contain the SYSTEM confirm message
        const secondCallMessages = ollama.queryOllama.mock.calls[1][1].messages;
        const sysMsg = secondCallMessages.find(m => m.role === 'system' && m.content.includes('Stored memory'));
        expect(sysMsg).toBeDefined();
    });

    test('handles missing key gracefully without calling set()', async () => {
        mockToolCall('<<<RUN_COMMAND: {"command": "remember", "value": "orphan value"}>>>');

        await chatCmd.execute(makeInteraction('remember something'));

        expect(mockMemorySet).not.toHaveBeenCalled();
        const secondCallMessages = ollama.queryOllama.mock.calls[1][1].messages;
        const errMsg = secondCallMessages.find(m => m.content.includes('missing key or value'));
        expect(errMsg).toBeDefined();
    });
});

// ─── recall ─────────────────────────────────────────────────────────────────
describe('chat.js — recall command', () => {
    test('calls AgentMemory.get with guildId and injects result into followup', async () => {
        mockMemoryGet.mockReturnValue('America/Chicago');
        mockToolCall('<<<RUN_COMMAND: {"command": "recall", "key": "user.cruise.tz"}>>>');

        await chatCmd.execute(makeInteraction("what's my timezone?"));

        expect(mockMemoryGet).toHaveBeenCalledWith('user.cruise.tz', GUILD_ID);
        const secondCallMessages = ollama.queryOllama.mock.calls[1][1].messages;
        const recallMsg = secondCallMessages.find(m => m.content.includes('America/Chicago'));
        expect(recallMsg).toBeDefined();
    });

    test('injects "no memory found" message when key is absent', async () => {
        mockMemoryGet.mockReturnValue(null);
        mockToolCall('<<<RUN_COMMAND: {"command": "recall", "key": "user.cruise.fav_food"}>>>');

        await chatCmd.execute(makeInteraction("what's my favorite food?"));

        const secondCallMessages = ollama.queryOllama.mock.calls[1][1].messages;
        const msg = secondCallMessages.find(m => m.content.includes('No memory found'));
        expect(msg).toBeDefined();
    });
});

// ─── forget ──────────────────────────────────────────────────────────────────
describe('chat.js — forget command', () => {
    test('calls AgentMemory.delete with the correct key', async () => {
        mockToolCall('<<<RUN_COMMAND: {"command": "forget", "key": "server.behavior"}>>>');

        await chatCmd.execute(makeInteraction('forget that behavior'));

        expect(mockMemoryDelete).toHaveBeenCalledWith('server.behavior');
    });
});

// ─── schedule ────────────────────────────────────────────────────────────────
describe('chat.js — schedule command', () => {
    test('calls AgentScheduler.add with resolved timestamp and correct userId/guildId', async () => {
        const { resolveTime } = require('../util/AgentClock');
        const futureTs = Date.now() + 3_600_000;
        resolveTime.mockResolvedValue(futureTs);

        mockToolCall('<<<RUN_COMMAND: {"command": "schedule", "message": "Back up the config!", "when": "in 1 hour", "target": "dm"}>>>');

        await chatCmd.execute(makeInteraction('remind me to back up in 1 hour'));

        expect(mockSchedulerAdd).toHaveBeenCalledWith(expect.objectContaining({
            description: 'Back up the config!',
            scheduledAt: futureTs,
            userId: 'user-999',
            guildId: GUILD_ID,
            channelId: 'dm'
        }));
    });

    test('injects error message when resolveTime returns null', async () => {
        const { resolveTime } = require('../util/AgentClock');
        resolveTime.mockResolvedValue(null);

        mockToolCall('<<<RUN_COMMAND: {"command": "schedule", "message": "Do something", "when": "next purple moon"}>>>');

        await chatCmd.execute(makeInteraction('schedule something'));

        expect(mockSchedulerAdd).not.toHaveBeenCalled();
        const secondCallMessages = ollama.queryOllama.mock.calls[1][1].messages;
        const errMsg = secondCallMessages.find(m => m.content.includes('Could not parse time'));
        expect(errMsg).toBeDefined();
    });

    test('handles daily repeat correctly', async () => {
        const { resolveTime } = require('../util/AgentClock');
        resolveTime.mockResolvedValue(Date.now() + 3_600_000);

        mockToolCall('<<<RUN_COMMAND: {"command": "schedule", "message": "Daily standup!", "when": "tomorrow at 9am", "target": "channel", "repeat": "daily"}>>>');

        await chatCmd.execute(makeInteraction('remind channel daily'));

        expect(mockSchedulerAdd).toHaveBeenCalledWith(expect.objectContaining({
            repeat: 'daily',
            channelId: 'channel-abc' // 'channel' target resolves to interaction.channelId
        }));
    });
});

// ─── cancel_task ─────────────────────────────────────────────────────────────
describe('chat.js — cancel_task command', () => {
    test('calls AgentScheduler.cancel with the task id', async () => {
        mockToolCall('<<<RUN_COMMAND: {"command": "cancel_task", "id": "task_abc_123"}>>>');

        await chatCmd.execute(makeInteraction('cancel that reminder'));

        expect(mockSchedulerCancel).toHaveBeenCalledWith('task_abc_123');
    });

    test('confirms cancellation via followup LLM call', async () => {
        mockToolCall('<<<RUN_COMMAND: {"command": "cancel_task", "id": "task_abc_123"}>>>');

        await chatCmd.execute(makeInteraction('cancel that reminder'));

        expect(ollama.queryOllama).toHaveBeenCalledTimes(2);
        const secondCallMessages = ollama.queryOllama.mock.calls[1][1].messages;
        const sysMsg = secondCallMessages.find(m => m.content.includes('cancelled successfully'));
        expect(sysMsg).toBeDefined();
    });

    test('injects "not found" message when cancel returns false', async () => {
        mockSchedulerCancel.mockReturnValue(false);
        mockToolCall('<<<RUN_COMMAND: {"command": "cancel_task", "id": "task_ghost_999"}>>>');

        await chatCmd.execute(makeInteraction('cancel a nonexistent task'));

        const secondCallMessages = ollama.queryOllama.mock.calls[1][1].messages;
        const sysMsg = secondCallMessages.find(m => m.content.includes('No task with ID'));
        expect(sysMsg).toBeDefined();
    });
});

// ─── list_tasks ───────────────────────────────────────────────────────────────
describe('chat.js — list_tasks command', () => {
    test('calls getByUser with interaction userId', async () => {
        mockToolCall('<<<RUN_COMMAND: {"command": "list_tasks"}>>>');

        await chatCmd.execute(makeInteraction('what tasks do you have scheduled?'));

        expect(mockSchedulerGetByUser).toHaveBeenCalledWith('user-999');
    });

    test('injects "no tasks" message when queue is empty', async () => {
        mockSchedulerGetByUser.mockReturnValue([]);
        mockToolCall('<<<RUN_COMMAND: {"command": "list_tasks"}>>>');

        await chatCmd.execute(makeInteraction('list my tasks'));

        const secondCallMessages = ollama.queryOllama.mock.calls[1][1].messages;
        const sysMsg = secondCallMessages.find(m => m.content.includes('No scheduled tasks'));
        expect(sysMsg).toBeDefined();
    });

    test('injects task details when queue is non-empty', async () => {
        mockSchedulerGetByUser.mockReturnValue([{
            id: 'task_1',
            description: 'Back up config',
            scheduledAt: Date.now() + 3_600_000,
            repeat: 'daily'
        }]);
        mockToolCall('<<<RUN_COMMAND: {"command": "list_tasks"}>>>');

        await chatCmd.execute(makeInteraction('list my tasks'));

        const secondCallMessages = ollama.queryOllama.mock.calls[1][1].messages;
        const sysMsg = secondCallMessages.find(m => m.content.includes('Back up config'));
        expect(sysMsg).toBeDefined();
        expect(sysMsg.content).toContain('daily');
    });
});

// ─── Memory injection into system prompt ─────────────────────────────────────
describe('chat.js — memory context injection', () => {
    test('injects memory summary into system prompt when memory is non-empty', async () => {
        mockMemoryGetSummary.mockReturnValue('user.cruise.lang = English');
        ollama.queryOllama.mockResolvedValue({ message: { role: 'assistant', content: 'Hello!' } });

        await chatCmd.execute(makeInteraction('hello'));

        const firstCallMessages = ollama.queryOllama.mock.calls[0][1].messages;
        const sysMsg = firstCallMessages.find(m => m.role === 'system');
        expect(sysMsg.content).toContain('LONG-TERM MEMORY');
        expect(sysMsg.content).toContain('user.cruise.lang = English');
    });

    test('passes guildId to getSummary for scoped injection', async () => {
        ollama.queryOllama.mockResolvedValue({ message: { role: 'assistant', content: 'Hello!' } });

        await chatCmd.execute(makeInteraction('hello'));

        expect(mockMemoryGetSummary).toHaveBeenCalledWith(GUILD_ID);
    });

    test('omits dynamic memory block when memory is empty', async () => {
        mockMemoryGetSummary.mockReturnValue(null);
        ollama.queryOllama.mockResolvedValue({ message: { role: 'assistant', content: 'Hello!' } });

        await chatCmd.execute(makeInteraction('hello'));

        const firstCallMessages = ollama.queryOllama.mock.calls[0][1].messages;
        const sysMsg = firstCallMessages.find(m => m.role === 'system');
        // The static system_prompt.txt mentions "LONG-TERM MEMORY" as documentation,
        // but the dynamic block is only injected when getSummary returns a non-null value.
        // When memory is empty, there should be no key=value pairs injected.
        expect(sysMsg.content).not.toMatch(/LONG-TERM MEMORY:\n\S/); // no actual data block
    });
});
