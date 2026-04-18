const { getParam } = require('../util/commandHelper');

describe('commandHelper', () => {
    describe('getParam', () => {
        test('resolves flat top-level parameters', () => {
            const data = { command: 'test', key: 'value' };
            expect(getParam(data, 'key')).toBe('value');
        });

        test('resolves nested params object', () => {
            const data = { command: 'test', params: { key: 'value' } };
            expect(getParam(data, 'key')).toBe('value');
        });

        test('prefers flat parameters over nested if both exist', () => {
            const data = { command: 'test', key: 'flat', params: { key: 'nested' } };
            expect(getParam(data, 'key')).toBe('flat');
        });

        test('resolves semantic fallbacks (content)', () => {
            const data = { command: 'test', message: 'hello' };
            expect(getParam(data, 'content')).toBe('hello');
            
            const data2 = { command: 'test', params: { text: 'world' } };
            expect(getParam(data2, 'content')).toBe('world');
        });

        test('resolves semantic fallbacks (options)', () => {
            const data = { command: 'test', choices: [1, 2] };
            expect(getParam(data, 'options')).toEqual([1, 2]);
        });

        test('resolves channel/target fallbacks', () => {
            const data = { command: 'test', target: '123' };
            expect(getParam(data, 'channel')).toBe('123');
        });

        test('returns null for missing keys', () => {
            const data = { command: 'test' };
            expect(getParam(data, 'missing')).toBe(null);
        });

        test('handles malformed data gracefully', () => {
            expect(getParam(null, 'key')).toBe(null);
            expect(getParam(undefined, 'key')).toBe(null);
            expect(getParam("not an object", 'key')).toBe(null);
        });
    });
});
