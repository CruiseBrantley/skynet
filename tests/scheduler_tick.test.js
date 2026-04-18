const AgentScheduler = require('../util/AgentScheduler');
const logger = require('../logger');
const fs = require('fs');
const path = require('path');

jest.mock('../logger');

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

        expect(bot.users.fetch).toHaveBeenCalledWith('user-123');
        expect(mockUser.send).toHaveBeenCalledWith('Hello DM');
        expect(AgentScheduler.getAll()).not.toContainEqual(expect.objectContaining({ id: task.id }));
    });

    test('delivers channel tasks and marks them complete', async () => {
        const task = AgentScheduler.add({
            description: 'Hello Channel',
            scheduledAt: Date.now() - 1000,
            channelId: 'chan-456'
        });

        await AgentScheduler.processDueTasks(bot);

        expect(bot.channels.cache.get).toHaveBeenCalledWith('chan-456');
        expect(mockChannel.send).toHaveBeenCalledWith('Hello Channel');
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

        expect(mockUser.send).toHaveBeenCalled();
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

        await AgentScheduler.processDueTasks(bot);

        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not deliver task'));
        // One-shot tasks should still be cleared even if delivery fails to avoid infinite spamming 
        // if the user deleted their account or blocked the bot.
        expect(AgentScheduler.getAll()).not.toContainEqual(expect.objectContaining({ id: task.id }));
    });
});
