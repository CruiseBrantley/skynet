const { extractUrls, shouldSkipUrl, splitMessage } = require('../util/summarize');

describe('Summarize Utilities', () => {

    // --- extractUrls ---
    describe('extractUrls', () => {
        test('returns empty array for null/undefined input', () => {
            expect(extractUrls(null)).toEqual([]);
            expect(extractUrls(undefined)).toEqual([]);
            expect(extractUrls('')).toEqual([]);
        });

        test('extracts a single URL', () => {
            expect(extractUrls('check https://example.com please')).toEqual(['https://example.com']);
        });

        test('extracts multiple URLs', () => {
            const urls = extractUrls('Visit https://a.com and http://b.com today');
            expect(urls).toEqual(['https://a.com', 'http://b.com']);
        });

        test('returns empty array for text with no URLs', () => {
            expect(extractUrls('no links here')).toEqual([]);
        });
    });

    // --- shouldSkipUrl ---
    describe('shouldSkipUrl', () => {
        test('skips image URLs', () => {
            expect(shouldSkipUrl('https://example.com/photo.png')).toBe(true);
            expect(shouldSkipUrl('https://example.com/pic.jpg')).toBe(true);
            expect(shouldSkipUrl('https://example.com/img.gif')).toBe(true);
        });

        test('skips Discord links', () => {
            expect(shouldSkipUrl('https://discord.com/invite/abc')).toBe(true);
            expect(shouldSkipUrl('https://discord.gg/abc')).toBe(true);
        });

        test('skips Twitch, Tenor and Giphy links', () => {
            expect(shouldSkipUrl('https://twitch.tv/streamer')).toBe(true);
            expect(shouldSkipUrl('https://tenor.com/view/gif')).toBe(true);
            expect(shouldSkipUrl('https://giphy.com/gifs/funny')).toBe(true);
        });

        test('allows normal article URLs', () => {
            expect(shouldSkipUrl('https://news.ycombinator.com/item?id=123')).toBe(false);
            expect(shouldSkipUrl('https://blog.example.com/post')).toBe(false);
        });
    });

    // --- splitMessage ---
    describe('splitMessage', () => {
        test('returns single chunk for short text', () => {
            const chunks = splitMessage('Hello world');
            expect(chunks).toHaveLength(1);
            expect(chunks[0]).toContain('Hello world');
        });

        test('splits long text into multiple chunks', () => {
            const longLine = 'a'.repeat(100);
            const text = Array(25).fill(longLine).join('\n'); // 25 * 100 = 2500 chars
            const chunks = splitMessage(text, 500);
            expect(chunks.length).toBeGreaterThan(1);
            chunks.forEach(chunk => expect(chunk.length).toBeLessThanOrEqual(510)); // small tolerance for newlines
        });

        test('handles null/empty input gracefully', () => {
            expect(splitMessage(null)).toEqual(['']);
            expect(splitMessage('')).toEqual(['']);
        });
    });
});
