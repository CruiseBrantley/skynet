jest.mock('@ngrok/ngrok', () => ({
    connect: jest.fn(),
    disconnect: jest.fn().mockResolvedValue(),
}));
jest.mock('../logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));

const ngrok = require('@ngrok/ngrok');
const getURL = require('../server/ngrok');

describe('ngrok.getURL', () => {
    beforeEach(() => jest.clearAllMocks());

    test('returns a tunnel URL when ngrok connects successfully', async () => {
        ngrok.connect.mockResolvedValueOnce({ url: () => 'https://abc123.ngrok.io' });

        const url = await getURL();

        expect(url).toBe('https://abc123.ngrok.io');
        expect(ngrok.connect).toHaveBeenCalled();
    });

    test('returns undefined and does not throw when ngrok fails', async () => {
        ngrok.connect.mockRejectedValueOnce(new Error('session limit reached'));

        const url = await getURL();

        expect(url).toBeUndefined();
    });
});
