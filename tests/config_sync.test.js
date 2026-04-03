const fs = require('fs');
const setupConfigSync = require('../util/configSync');

jest.mock('fs');
jest.mock('../logger');

describe('configSync', () => {
    let mockDB;
    let mockRef;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRef = {
            once: jest.fn().mockImplementation((event, callback) => {
                callback({
                    exists: () => true,
                    val: () => ({ remote: 'config' })
                });
            }),
            set: jest.fn().mockResolvedValue({}),
            on: jest.fn()
        };
        mockDB = {
            ref: jest.fn().mockReturnValue(mockRef)
        };
    });

    test('successfully pulls from Firebase on initialization', () => {
        setupConfigSync(mockDB);
        expect(mockDB.ref).toHaveBeenCalledWith('twitch_announcements');
        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('remote'));
    });

    test('initializes Firebase if remote config is missing', () => {
        mockRef.once.mockImplementation((event, callback) => {
            callback({
                exists: () => false
            });
        });
        fs.readFileSync.mockReturnValue(JSON.stringify({ local: 'config' }));

        setupConfigSync(mockDB);
        
        expect(mockRef.set).toHaveBeenCalledWith({ local: 'config' });
    });

    test('updateRemote correctly pushes changes to Firebase', () => {
        const sync = setupConfigSync(mockDB);
        sync.updateRemote({ new: 'config' });
        expect(mockRef.set).toHaveBeenCalledWith({ new: 'config' });
    });
});
