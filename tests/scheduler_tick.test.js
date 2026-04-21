const AgentScheduler = require('../util/AgentScheduler');
const logger = require('../logger');
const fs = require('fs');
const path = require('path');

jest.mock('../logger');
jest.mock('fs');

const ActionExecutor = require('../util/ActionExecutor');
const mockActionExecute = jest.spyOn(ActionExecutor, 'execute').mockResolvedValue(true);

describe('AgentScheduler.processDueTasks', () => {
    let bot;
    let mockUser;
    let mockChannel;

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Mock Discord bot
        mockUser = {
            send: jest.fn().mockResolvedValue({})
        };
        mockChannel = {
            send: jest.fn().mockResolvedValue({})
        };
        
        bot = {
            users: {
                fetch: jest.fn().mockResolvedValue(mockUser)
            },
            channels: {
                cache: {
                    get: jest.fn().mockReturnValue(mockChannel)
                }
            }
        };

        // Reset scheduler state (but use the real class logic)
        AgentScheduler._tasks = [];
    });

    test('delivers DM tasks and marks them complete', async () => {
        const task = AgentScheduler.add({
            description: 'Hello DM',
            scheduledAt: Date.now() - 1000,
            userId: 'user-123',
            channelId: 'dm'
        });

        await AgentScheduler.processDueTasks(bot);
        expect(mockActionExecute).toHaveBeenCalledWith(bot, expect.objectContaining({ description: 'Hello DM' }));
        expect(AgentScheduler.getAll()).not.toContainEqual(expect.objectContaining({ id: task.id }));
    });

    test('delivers channel tasks and marks them complete', async () => {
        const task = AgentScheduler.add({
            description: 'Hello Channel',
            scheduledAt: Date.now() - 1000,
            channelId: 'chan-456'
        });

        await AgentScheduler.processDueTasks(bot);
        expect(mockActionExecute).toHaveBeenCalledWith(bot, expect.objectContaining({ description: 'Hello Channel' }));
        expect(AgentScheduler.getAll()).not.toContainEqual(expect.objectContaining({ id: task.id }));
    });

    test('reschedules repeating tasks instead of deleting them', async () => {
        const initialTime = Date.now() - 1000;
        const task = AgentScheduler.add({
            description: 'Daily standup',
            scheduledAt: initialTime,
            userId: 'user-123',
            channelId: 'dm',
            repeat: 'daily'
        });

        await AgentScheduler.processDueTasks(bot);
        expect(mockActionExecute).toHaveBeenCalled();
        const rescheduled = AgentScheduler.getAll().find(t => t.id === task.id);
        expect(rescheduled).toBeDefined();
        expect(rescheduled.scheduledAt).toBe(initialTime + 86_400_000);
    });

    test('handles failed delivery (user not found) gracefully', async () => {
        bot.users.fetch.mockRejectedValue(new Error('DiscordAPIError: Unknown User'));
        
        const task = AgentScheduler.add({
            description: 'Orphan task',
            scheduledAt: Date.now() - 1000,
            userId: 'ghost-user',
            channelId: 'dm'
        });

        mockActionExecute.mockResolvedValueOnce(false);
        await AgentScheduler.processDueTasks(bot);
        // One-shot tasks should remain if delivery failed (for retry)
        expect(AgentScheduler.getAll()).toContainEqual(expect.objectContaining({ id: task.id }));
    });
});
