const listnotes = require('../commands/listnotes');
const axios = require('axios');
const logger = require('../logger');

jest.mock('axios');
jest.mock('../logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
}));

describe('listnotes command', () => {
    let mockInteraction;

    beforeEach(() => {
        jest.clearAllMocks();
        mockInteraction = {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
        };
    });

    test('should have valid metadata', () => {
        expect(listnotes.data.name).toBe('listnotes');
        expect(listnotes.data.description).toBe('List all current notes in the notes database');
    });

    test('should handle empty notes list', async () => {
        axios.get.mockResolvedValueOnce({ data: { notes: [] } });

        await listnotes.execute(mockInteraction);
        await new Promise(process.nextTick);

        expect(mockInteraction.deferReply).toHaveBeenCalled();
        expect(axios.get).toHaveBeenCalledWith(process.env.NOTESPOST, expect.any(Object));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(
            expect.stringContaining('There aren\'t currently any notes')
        );
    });

    test('should list notes with and without titles', async () => {
        const mockNotes = [
            { title: 'Shopping', text: 'Milk, Eggs' },
            { title: 'Untitled', text: 'Random thought' }
        ];
        
        axios.get.mockResolvedValueOnce({ data: { notes: mockNotes } });

        await listnotes.execute(mockInteraction);
        await new Promise(process.nextTick);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(
            '```Current Notes:\nShopping: Milk, Eggs\nRandom thought```'
        );
    });

    test('should handle API errors gracefully', async () => {
        const mockError = new Error('Network Error');
        axios.get.mockRejectedValueOnce(mockError);

        await listnotes.execute(mockInteraction);
        await new Promise(process.nextTick);

        expect(logger.info).toHaveBeenCalledWith(mockError);
        expect(mockInteraction.editReply).toHaveBeenCalledWith('There was an error fetching the notes.');
    });
});
