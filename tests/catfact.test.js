const catfact = require('../commands/catfact');
const axios = require('axios');
const logger = require('../logger');
const { MessageFlags } = require('discord.js');

jest.mock('axios');
jest.mock('../logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
}));

describe('catfact command', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should have valid data', () => {
        expect(catfact.data.name).toBe('catfact');
        expect(catfact.data.description).toBe('Get a random cat fact');
    });

    test('should fetch and reply with a cat fact successfully', async () => {
        const mockInteraction = {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
        };

        const mockFact = 'Cats sleep a lot.';
        axios.get.mockResolvedValueOnce({ data: { fact: mockFact } });

        await catfact.execute(mockInteraction);

        // Wait for the async promise chain inside the .then() to finish
        await new Promise(process.nextTick);

        expect(mockInteraction.deferReply).toHaveBeenCalled();
        expect(axios.get).toHaveBeenCalledWith(process.env.CATFACT_GET);
        expect(mockInteraction.editReply).toHaveBeenCalledWith({
            content: mockFact,
            flags: [MessageFlags.SuppressEmbeds],
        });
    });

    test('should handle API errors gracefully', async () => {
        const mockInteraction = {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
        };

        const mockError = new Error('API Error');
        axios.get.mockRejectedValueOnce(mockError);

        await catfact.execute(mockInteraction);

        // Wait for the async promise chain inside the .catch() to finish
        await new Promise(process.nextTick);

        expect(mockInteraction.deferReply).toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith(mockError);
        expect(mockInteraction.editReply).toHaveBeenCalledWith('Could not retrieve a cat fact at this time.');
    });
});
