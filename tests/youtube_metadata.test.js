const youtube = require('../util/YouTubeMetadata');

describe('YouTubeMetadata', () => {
    describe('extractVideoId', () => {
        test('extracts from standard URL', () => {
            expect(youtube.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
        });

        test('extracts from short URL', () => {
            expect(youtube.extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
        });

        test('extracts from shorts URL', () => {
            expect(youtube.extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
        });

        test('handles extra query parameters', () => {
            expect(youtube.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toBe('dQw4w9WgXcQ');
        });

        test('returns null for non-youtube URLs', () => {
            expect(youtube.extractVideoId('https://google.com')).toBeNull();
        });
    });

    describe('isYouTubeURL', () => {
        test('identifies valid domains', () => {
            expect(youtube.isYouTubeURL('https://youtube.com/watch?v=x')).toBe(true);
            expect(youtube.isYouTubeURL('https://music.youtube.com/watch?v=x')).toBe(true);
            expect(youtube.isYouTubeURL('https://youtu.be/x')).toBe(true);
        });

        test('rejects unrelated domains', () => {
            expect(youtube.isYouTubeURL('https://spotify.com')).toBe(false);
            expect(youtube.isYouTubeURL('lofi hip hop')).toBe(false);
        });
    });

    describe('_parseISO8601Duration', () => {
        test('parses PT3M42S', () => {
            expect(youtube._parseISO8601Duration('PT3M42S')).toBe(222);
        });

        test('parses PT1H2M3S', () => {
            expect(youtube._parseISO8601Duration('PT1H2M3S')).toBe(3723);
        });

        test('handles single components', () => {
            expect(youtube._parseISO8601Duration('PT5M')).toBe(300);
            expect(youtube._parseISO8601Duration('PT30S')).toBe(30);
        });
    });

    describe('_getBestThumbnail', () => {
        test('prioritizes maxres from API', () => {
            const thumbs = {
                default: { url: 'def' },
                high: { url: 'high' },
                maxres: { url: 'https://i.ytimg.com/vi/abc/maxresdefault.jpg' }
            };
            expect(youtube._getBestThumbnail(thumbs)).toBe('https://i.ytimg.com/vi/abc/maxresdefault.jpg');
        });

        test('force-upgrades search results to maxres', () => {
            const hq = { high: { url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg' } };
            expect(youtube._getBestThumbnail(hq)).toBe('https://i.ytimg.com/vi/abc/maxresdefault.jpg');

            const numbered = { default: { url: 'https://i.ytimg.com/vi/abc/3.jpg' } };
            expect(youtube._getBestThumbnail(numbered)).toBe('https://i.ytimg.com/vi/abc/maxresdefault.jpg');
        });

        test('handles URLs with query parameters', () => {
            const hq = { high: { url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=123' } };
            expect(youtube._getBestThumbnail(hq)).toBe('https://i.ytimg.com/vi/abc/maxresdefault.jpg');
        });
    });

    describe('getRecommendation fallback and filtering', () => {
        beforeEach(() => {
            jest.spyOn(youtube, 'search').mockImplementation(() => Promise.resolve([
                { title: 'Artist - Song (Official Video)', url: 'https://youtube.com/watch?v=11111111111' },
                { title: 'Artist - Song (Lyric Video)', url: 'https://youtube.com/watch?v=22222222222' },
                { title: 'Totally Different Song', url: 'https://youtube.com/watch?v=33333333333' },
            ]));
        });
        afterEach(() => {
            jest.restoreAllMocks();
        });

        test('filters out items in history', async () => {
            // Mock ollama to fail so it falls back to basic search
            jest.mock('../util/ollama', () => ({
                queryOllama: jest.fn().mockRejectedValue(new Error('llm offline'))
            }), { virtual: true });

            const history = new Set(['11111111111']);
            const lastTrack = { title: 'Some Base Track', url: 'https://youtube.com/watch?v=basebasebas' };
            const rec = await youtube.getRecommendation([lastTrack], history);
            
            expect(rec.url).toBe('https://youtube.com/watch?v=22222222222'); // 1 is filtered by history
        });
        
        test('filters out highly similar titles safely', async () => {
             const lastTrack = { title: 'Artist - Song (Official Music Video)', url: 'https://youtube.com/watch?v=basebasebas' };
             const history = new Set();
             
             const rec = await youtube.getRecommendation([lastTrack], history);
             expect(rec.url).toBe('https://youtube.com/watch?v=22222222222');
        });
    });
});
