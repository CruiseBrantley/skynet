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
});
