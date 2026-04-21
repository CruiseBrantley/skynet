jest.mock('../util/ollama');
const mockExecuteAction = jest.fn().mockResolvedValue({ success: true });
jest.mock('../util/ActionExecutor', () => ({
    executeAction: mockExecuteAction,
    listActions: jest.fn().mockReturnValue([{ name: 'web_search' }])
}));

jest.mock('../util/AgentMemory', () => ({
    getSummary: jest.fn().mockReturnValue(null),
    set: jest.fn(),
    get: jest.fn()
}));

const chat = require('../commands/chat');
const executor = require('../util/ActionExecutor');
const { queryOllamaWithContext } = require('../util/ollama');

describe('Chat Loop Safety & Scrubbing', () => {
    let mockInteraction;
    
    beforeEach(() => {
        jest.clearAllMocks();
        // Provide a safe default so the code doesn't crash on undefined
        queryOllamaWithContext.mockResolvedValue({ 
            message: { content: 'Default AI Response' } 
        });
        
        mockInteraction = {
            guildId: '123',
            channelId: '456',
            user: { id: '789', tag: 'sirian#0000' },
            member: { id: '789' },
            client: {
                user: { id: '555' },
                commands: { get: jest.fn().mockReturnValue(null) }
            },
            options: {
                getString: jest.fn().mockReturnValue('What is the weather?')
            },
            channel: {
                id: '456',
                send: jest.fn().mockResolvedValue({})
            },
            deferReply: jest.fn().mockResolvedValue({}),
            editReply: jest.fn().mockResolvedValue({}),
            followUp: jest.fn().mockResolvedValue({}),
            deleteReply: jest.fn().mockResolvedValue({}),
            edit: jest.fn().mockResolvedValue({})
        };
    });

    test('should break the loop when the same tool type is called twice (Query Shifting)', async () => {
        queryOllamaWithContext.mockResolvedValueOnce({ 
            message: { content: '<<<RUN_COMMAND: {"command": "web_search", "query": "weather today"}>>>' } 
        }).mockResolvedValueOnce({ 
            message: { content: '<<<RUN_COMMAND: {"command": "web_search", "query": "weather tomorrow"}>>>' } 
        }).mockResolvedValueOnce({ 
            message: { content: 'The weather is sunny.' } 
        });

        await chat.execute(mockInteraction, {});

        // Should have only triggered executeAction ONCE despite the AI asking twice
        expect(mockExecuteAction).toHaveBeenCalledTimes(1);

        // Final output should be clean
        const lastCall = mockInteraction.editReply.mock.calls[mockInteraction.editReply.mock.calls.length - 1][0];
        const content = typeof lastCall === 'string' ? lastCall : lastCall.content;
        expect(content).not.toContain('<<<RUN_COMMAND');
        expect(content).toContain('The weather is sunny');
    });

    test('should scrub tags from universal fallback (channel.send)', async () => {
        mockInteraction.editReply.mockRejectedValue(new Error('Interaction expired'));
        
        queryOllamaWithContext.mockResolvedValueOnce({ 
            message: { content: 'Here is the command: <<<RUN_COMMAND: {"command": "test"}>>>' } 
        });

        await chat.execute(mockInteraction, {});

        expect(mockInteraction.channel.send).toHaveBeenCalled();
        const sendArgs = mockInteraction.channel.send.mock.calls[0][0];
        const sentContent = typeof sendArgs === 'string' ? sendArgs : sendArgs.content;
        
        expect(sentContent).toContain('Here is the command:');
        expect(sentContent).not.toContain('<<<RUN_COMMAND');
    });
});
