const mockExecuteAction = jest.fn().mockResolvedValue({ success: true, output: "Mocked output" });
const mockListActions = jest.fn().mockReturnValue([
    { name: 'send_embed', description: 'Send an embed', schema: {} },
    { name: 'send_message', description: 'Send a message', schema: {} }
]);

jest.mock('../util/ActionExecutor', () => ({
    executeAction: mockExecuteAction,
    listActions: mockListActions
}));

const chat = require('../commands/chat');
const { queryOllamaWithContext } = require('../util/ollama');
const executor = require('../util/ActionExecutor');

jest.mock('../util/ollama');

describe('Unified Interaction Hardening Suite', () => {
    let mockInteraction;
    
    beforeEach(() => {
        jest.clearAllMocks();
        
        mockInteraction = {
            guildId: '123',
            channelId: '456',
            user: { id: '789', tag: 'sirian#0000', username: 'sirian' },
            member: { id: '789', nickname: 'Sirian' },
            client: {
                user: { id: '555', username: 'Skynet' },
                commands: { 
                    get: jest.fn().mockReturnValue(null),
                    map: jest.fn().mockReturnValue([])
                }
            },
            options: {
                getString: jest.fn().mockReturnValue('create an embed'),
                getAttachment: jest.fn().mockReturnValue(null)
            },
            channel: { 
                id: '456', 
                messages: { 
                    fetch: jest.fn().mockResolvedValue({ 
                        map: (cb) => [],
                        size: 0
                    }) 
                } 
            },
            deferReply: jest.fn().mockResolvedValue({}),
            editReply: jest.fn().mockResolvedValue({}),
            followUp: jest.fn().mockResolvedValue({}),
            deleteReply: jest.fn().mockResolvedValue({})
        };
    });

    test('Case 1: Standard Tagged Command', async () => {
        queryOllamaWithContext.mockResolvedValueOnce({ 
            message: { content: '<<<RUN_COMMAND: {"command": "send_embed", "params": {"title": "Test"}}>>>' } 
        });
        queryOllamaWithContext.mockResolvedValueOnce({
            message: { content: 'Acknowledged.' }
        });

        await chat.execute(mockInteraction, {});

        expect(executor.executeAction).toHaveBeenCalledWith('send_embed', expect.anything(), expect.anything());
        // Verify it didn't just print the JSON
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.not.stringContaining('RUN_COMMAND')
        }));
    });

    test('Case 2: Naked JSON Fallback (The User Reported Failure)', async () => {
        queryOllamaWithContext.mockResolvedValueOnce({ 
            message: { content: '{"command": "send_embed", "params": {"title": "Naked Test"}}' } 
        });
        queryOllamaWithContext.mockResolvedValueOnce({
            message: { content: 'I have sent that naked JSON embed.' }
        });

        await chat.execute(mockInteraction, {});

        // Should have caught the naked JSON
        expect(executor.executeAction).toHaveBeenCalledWith('send_embed', expect.anything(), expect.anything());
        // Should NOT have printed the JSON to the user
        const lastEdit = mockInteraction.editReply.mock.calls.find(c => c[0].content && c[0].content.includes('Naked Test'));
        expect(lastEdit).toBeUndefined(); // It should be in sharedState, not printed as content
    });

    test('Case 3: Nested Hallucination Recovery', async () => {
        // This test actually calls the real send_embed action to verify the flattener
        const sendEmbed = require('../util/actions/send_embed');
        const mockChannel = { send: jest.fn().mockResolvedValue({}) };
        
        const nestedParams = {
            embed: {
                title: "Flatten Me",
                description: "Nested content"
            }
        };

        await sendEmbed.execute({}, mockChannel, nestedParams);

        // Verify it flattened and used the nested title
        const lastSend = mockChannel.send.mock.calls[0][0];
        expect(lastSend.embeds[0].data.title).toBe("Flatten Me");
    });
});
