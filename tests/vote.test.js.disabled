const vote = require('../commands/vote');
const logger = require('../logger');

jest.mock('../logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
}));

describe('vote command', () => {
    let mockInteraction;
    let mockDatabase;
    let mockRef;

    beforeEach(() => {
        jest.clearAllMocks();

        mockRef = {
            once: jest.fn(),
            set: jest.fn(),
        };

        mockDatabase = {
            ref: jest.fn().mockReturnValue(mockRef),
        };

        mockInteraction = {
            guildId: '123',
            user: { id: 'user1' },
            options: {
                getSubcommand: jest.fn(),
                getString: jest.fn(),
            },
            reply: jest.fn().mockResolvedValue(),
            followUp: jest.fn().mockResolvedValue(),
            member: {
                permissions: {
                    has: jest.fn().mockReturnValue(true), // default to admin
                }
            }
        };
    });

    test('metadata is correct', () => {
        expect(vote.data.name).toBe('vote');
        expect(vote.data.description).toContain('Voting');
    });

    test('list: shows empty records if undefined', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('list');
        mockRef.once.mockResolvedValue({ val: () => null });

        await vote.execute(mockInteraction, mockDatabase);
        
        expect(mockRef.once).toHaveBeenCalledWith('value');
        expect(mockInteraction.reply).toHaveBeenCalledWith(expect.stringContaining('# The current voting record is:'));
    });

    test('list: shows valid options and votes', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('list');
        mockRef.once.mockResolvedValue({ val: () => [
            { title: 'Option 1', hasVoted: ['user1', 'user2'] },
            { title: 'Option 2', hasVoted: [] }
        ] });

        await vote.execute(mockInteraction, mockDatabase);
        
        expect(mockInteraction.reply.mock.calls[0][0]).toContain('Option 1');
        expect(mockInteraction.reply.mock.calls[0][0]).toContain('Votes:\t2');
        expect(mockInteraction.reply.mock.calls[0][0]).toContain('Option 2');
        expect(mockInteraction.reply.mock.calls[0][0]).toContain('Votes:\t0');
    });

    test('add: adds options when admin', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('add');
        mockInteraction.options.getString.mockReturnValue('Item C, Item D');
        mockRef.once.mockResolvedValue({ val: () => [ { title: 'Item A', hasVoted: [] } ] });

        await vote.execute(mockInteraction, mockDatabase);

        expect(mockRef.set).toHaveBeenCalledWith([
            { title: 'Item A', hasVoted: [] },
            { title: 'Item C', hasVoted: [] },
            { title: 'Item D', hasVoted: [] }
        ]);
        expect(mockInteraction.reply).toHaveBeenCalledWith('Added successfully.');
    });

    test('add: prevents non-admin', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('add');
        mockInteraction.member.permissions.has.mockReturnValue(false);

        await vote.execute(mockInteraction, mockDatabase);

        expect(mockRef.set).not.toHaveBeenCalled();
        expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'You must have admin permissions to modify vote options.' }));
    });

    test('cast: casts a successful vote', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('cast');
        mockInteraction.options.getString.mockReturnValue('Banana');
        mockRef.once.mockResolvedValue({ val: () => [
            { title: 'Apple', hasVoted: [] },
            { title: 'Banana', hasVoted: [] }
        ] });

        await vote.execute(mockInteraction, mockDatabase);
        
        expect(mockInteraction.reply).toHaveBeenCalledWith('Your vote for `Banana` has been recorded.');
        expect(mockRef.set).toHaveBeenCalledWith([
            { title: 'Banana', hasVoted: ['user1'] },
            { title: 'Apple', hasVoted: [] } // Order could change due to sort
        ]);
    });

    test('cast: prevents double voting', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('cast');
        mockInteraction.options.getString.mockReturnValue('Apple');
        mockRef.once.mockResolvedValue({ val: () => [
            { title: 'Apple', hasVoted: ['user1'] },
            { title: 'Banana', hasVoted: [] }
        ] });

        await vote.execute(mockInteraction, mockDatabase);
        
        expect(mockInteraction.reply).toHaveBeenCalledWith("I'm sorry, you've already voted for `Apple`.");
        expect(mockRef.set).not.toHaveBeenCalled();
    });

    test('cast: vote not found', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('cast');
        mockInteraction.options.getString.mockReturnValue('Pear');
        mockRef.once.mockResolvedValue({ val: () => [
            { title: 'Apple', hasVoted: [] },
        ] });

        await vote.execute(mockInteraction, mockDatabase);
        
        expect(mockInteraction.reply).toHaveBeenCalledWith({ content: "I couldn't find that option.", ephemeral: true });
        expect(mockRef.set).not.toHaveBeenCalled();
    });

    test('unvote: unvotes correctly', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('unvote');
        mockRef.once.mockResolvedValue({ val: () => [
            { title: 'Apple', hasVoted: ['user1'] },
        ] });

        await vote.execute(mockInteraction, mockDatabase);

        expect(mockInteraction.reply).toHaveBeenCalledWith('Your vote has been reset.');
        expect(mockRef.set).toHaveBeenCalledWith([
            { title: 'Apple', hasVoted: [] }
        ]);
    });

    test('unvote: warns if no vote exists', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('unvote');
        mockRef.once.mockResolvedValue({ val: () => [
            { title: 'Apple', hasVoted: [] },
        ] });

        await vote.execute(mockInteraction, mockDatabase);

        expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "You haven't even voted..." }));
    });

    test('remove: removes correctly', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('remove');
        mockInteraction.options.getString.mockReturnValue('Apple');
        mockRef.once.mockResolvedValue({ val: () => [
            { title: 'Apple', hasVoted: [] },
            { title: 'Banana', hasVoted: [] },
        ] });

        await vote.execute(mockInteraction, mockDatabase);
        expect(mockRef.set).toHaveBeenCalledWith([{ title: 'Banana', hasVoted: [] }]);
    });

    test('remove: not found', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('remove');
        mockInteraction.options.getString.mockReturnValue('Pear');
        mockRef.once.mockResolvedValue({ val: () => [
            { title: 'Apple', hasVoted: [] },
        ] });

        await vote.execute(mockInteraction, mockDatabase);
        expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "Couldn't find Pear." }));
    });
    
    test('reset: resets correctly', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('reset');
        mockRef.once.mockResolvedValue({ val: () => [
            { title: 'Apple', hasVoted: ['user1', 'user2'] },
        ] });

        await vote.execute(mockInteraction, mockDatabase);
        expect(mockRef.set).toHaveBeenCalledWith([{ title: 'Apple', hasVoted: [] }]);
    });

    test('clear: clears database', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('clear');

        await vote.execute(mockInteraction, mockDatabase);
        expect(mockRef.set).toHaveBeenCalledWith([]);
        expect(mockInteraction.reply).toHaveBeenCalledWith('Cleared all vote options.');
    });

    test('handles errors gracefully', async () => {
        mockInteraction.options.getSubcommand.mockReturnValue('list');
        mockRef.once.mockRejectedValue(new Error('Firebase DB Error'));

        await vote.execute(mockInteraction, mockDatabase);

        expect(logger.error).toHaveBeenCalledWith('There was a vote error (list): ', expect.any(Error));
        expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'An error occurred processing your vote command.' }));
    });
});
