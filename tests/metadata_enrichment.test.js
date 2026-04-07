const fs = require('fs');
const path = require('path');

// Mock dependencies
jest.mock('../logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
}));

// We'll mock the whole YouTubeMetadata singleton for this test
// Prefix with 'mock' so it exists in the hoisted scope
const mockYoutube = {
    cache: {
        get: jest.fn(),
        set: jest.fn(),
        clear: jest.fn(),
    },
    _updateCache: jest.fn(),
};
jest.mock('../util/YouTubeMetadata', () => mockYoutube);

const playVideo = require('../util/playVideo');

// We need to access the internal functions of playVideo.js. 
// Since they are not exported directly, we might need a workaround or test the side effects of downloadVideo.
// But downloadVideo IS exported.

describe('Metadata Enrichment Path Resolution', () => {
    const TEMP_DIR = path.join(__dirname, '../temp_music');
    const videoId = 'ABCDEFGHIJK';
    const targetPath = path.join(TEMP_DIR, `${videoId}.opus`);
    const infoPath = `${targetPath}.info.json`;

    beforeEach(() => {
        jest.clearAllMocks();
        mockYoutube.cache.get.mockReset();
        mockYoutube.cache.set.mockReset();
        
        // Mock implementation for _updateCache to match YouTubeMetadata behavior
        mockYoutube._updateCache.mockImplementation((id, data) => {
            mockYoutube.cache.set(id, data);
        });

        if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
    });

    afterEach(() => {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        if (fs.existsSync(infoPath)) fs.unlinkSync(infoPath);
    });

    test('enrichMetadataFromInfoJson should correctly resolve path and update cache', async () => {
        // Create mock info.json
        const mockInfo = {
            title: 'Test Song',
            duration: 300,
            uploader: 'Test Channel'
        };
        fs.writeFileSync(infoPath, JSON.stringify(mockInfo));
        fs.writeFileSync(targetPath, 'dummy data');

        // We'll trigger it via downloadVideo's cached hit branch
        await playVideo.downloadVideo('https://youtube.com/watch?v=ABCDEFGHIJK');

        expect(mockYoutube._updateCache).toHaveBeenCalledWith('ABCDEFGHIJK', expect.objectContaining({
            durationSeconds: 300,
            title: 'Test Song'
        }));
        
        // Should have cleaned up the info.json
        expect(fs.existsSync(infoPath)).toBe(false);
    });
});
