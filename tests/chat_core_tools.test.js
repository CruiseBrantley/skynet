const chat = require('../commands/chat');
const { queryOllama, queryOllamaWithContext } = require('../util/ollama');
const ActionExecutor = require('../util/ActionExecutor');
const agentMemory = require('../util/AgentMemory');

jest.mock('../util/ollama', () => ({
    queryOllama: jest.fn(),
    queryOllamaWithContext: jest.fn()
}));
jest.mock('../util/AgentMemory');
jest.mock('../util/AgentScheduler');
jest.mock('google-it');
jest.mock('../logger');
jest.mock('../util/ActionExecutor', () => ({
    listActions: jest.fn().mockReturnValue([
        { name: 'schedule', description: 'Schedule' },
        { name: 'cancel_task', description: 'Cancel' },
        { name: 'web_search', description: 'Search' },
        { name: 'list_tasks', description: 'List' },
        { name: 'add_reaction', description: 'React' }
    ]),
    executeAction: jest.fn()
}));
jest.mock('../util/puppeteerSearch', () => ({
    performSearch: jest.fn().mockResolvedValue([])
}));
jest.mock('../util/AgentClock', () => ({
    resolveTime: jest.fn().mockResolvedValue(1713400000000)
}));

describe('chat.js - Unified Action Execution Baseline', () => {
    let mockInteraction;
    const database = {};

    beforeEach(() => {
        jest.clearAllMocks();

        mockInteraction = {
            id: 'mock-1',
            client: { 
                user: { id: 'bot-id' }, 
                commands: { map: jest.fn().mockReturnValue([]), get: jest.fn() },
                users: { cache: new Map() }
            },
            user: { id: 'user-id', username: 'testuser', tag: 'testuser#1234' },
            member: { displayName: 'testuser' },
            guildId: 'guild-1',
            channelId: 'channel-1',
            channel: { 
                messages: { fetch: jest.fn().mockResolvedValue(new Map()) },
                send: jest.fn()
            },
            options: {
                getString: jest.fn().mockImplementation((name) => {
                    if (name === 'message') return 'test message';
                    return null;
                }),
                getAttachment: jest.fn().mockReturnValue(null)
            },
            deferReply: jest.fn().mockResolvedValue(true),
            editReply: jest.fn().mockResolvedValue(true),
            followUp: jest.fn().mockResolvedValue(true),
            deleteReply: jest.fn().mockResolvedValue(true),
            replied: false,
            deferred: true
        };
    });

    test('remember command updates AgentMemory', async () => {
        queryOllamaWithContext.mockResolvedValueOnce({
            message: { role: 'assistant', content: '<<<RUN_COMMAND: {"command": "remember", "key": "test_key", "value": "test_value"}>>>' }
        }).mockResolvedValueOnce({
            message: { role: 'assistant', content: 'I will remember that.' }
        });

        await chat.execute(mockInteraction, database);

        expect(agentMemory.set).toHaveBeenCalledWith('test_key', 'test_value', 30, 'guild-1');
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('I will remember that')
        }));
    });

    test('schedule command calls ActionExecutor with correct param order', async () => {
        const cmdPayload = { command: "schedule", params: { message: "test", when: "in 1m" } };
        queryOllamaWithContext.mockResolvedValueOnce({
            message: { role: 'assistant', content: `<<<RUN_COMMAND: ${JSON.stringify(cmdPayload)}>>>` }
        }).mockResolvedValueOnce({
            message: { role: 'assistant', content: 'Task scheduled summary' }
        });

        ActionExecutor.executeAction.mockResolvedValue({ success: true });

        await chat.execute(mockInteraction, database);

        // Parameters should be the SECOND argument, context should be the THIRD
        expect(ActionExecutor.executeAction).toHaveBeenCalledWith(
            'schedule', 
            expect.objectContaining(cmdPayload.params), 
            expect.objectContaining({ userId: 'user-id' })
        );
    });

    test('generic action (like add_reaction) calls ActionExecutor correctly', async () => {
        const cmdPayload = { command: "add_reaction", emoji: "👍", messageId: "123" };
        queryOllamaWithContext.mockResolvedValueOnce({
            message: { role: 'assistant', content: `<<<RUN_COMMAND: ${JSON.stringify(cmdPayload)}>>>` }
        }).mockResolvedValueOnce({
            message: { role: 'assistant', content: 'Reaction added.' }
        });

        ActionExecutor.executeAction.mockResolvedValue({ success: true });

        await chat.execute(mockInteraction, database);

        expect(ActionExecutor.executeAction).toHaveBeenCalledWith(
            'add_reaction',
            expect.objectContaining(cmdPayload),
            expect.objectContaining({ userId: 'user-id' })
        );
    });

    test('cancel_task command calls ActionExecutor', async () => {
        const cmdPayload = { command: "cancel_task", params: { id: "task-123" } };
        queryOllamaWithContext.mockResolvedValueOnce({
            message: { role: 'assistant', content: `<<<RUN_COMMAND: ${JSON.stringify(cmdPayload)}>>>` }
        }).mockResolvedValueOnce({
            message: { role: 'assistant', content: 'Task cancelled summary' }
        });

        ActionExecutor.executeAction.mockResolvedValue({ success: true });

        await chat.execute(mockInteraction, database);

        expect(ActionExecutor.executeAction).toHaveBeenCalledWith(
            'cancel_task', 
            expect.objectContaining(cmdPayload.params), 
            expect.objectContaining({ userId: 'user-id' })
        );
    });
});
