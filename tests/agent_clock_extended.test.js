/**
 * Extended AgentClock tests covering:
 * - Combined expressions ("tonight at 9pm", "tomorrow at 8am")
 * - 24-hour clock format
 * - Past-time → bumped to next occurrence
 * - Edge cases (null, empty)
 */
const { resolveTime, parseClockTime } = require('../util/AgentClock');

// Mock ollama so LLM fallback never makes a real network call
jest.mock('../util/ollama', () => ({
    queryOllama: jest.fn(),
    queryLocalOrRemote: jest.fn().mockRejectedValue(new Error('ollama offline'))
}));
jest.mock('../logger');

describe('AgentClock — extended coverage', () => {

    // ── Combined expressions ─────────────────────────────────────────────────
    test('"tonight at 9pm" resolves to 9pm today (or tomorrow)', async () => {
        const ts = await resolveTime('tonight at 9pm');
        expect(ts).not.toBeNull();
        const d = new Date(ts);
        expect(d.getHours()).toBe(21);
        expect(d.getMinutes()).toBe(0);
        expect(ts).toBeGreaterThan(Date.now() - 1000);
    });

    test('"tomorrow at 8am" resolves to tomorrow at 08:00', async () => {
        const ts = await resolveTime('tomorrow at 8am');
        expect(ts).not.toBeNull();
        const d = new Date(ts);
        expect(d.getHours()).toBe(8);
        expect(d.getMinutes()).toBe(0);
        // Must be in the future
        expect(ts).toBeGreaterThan(Date.now());
    });

    test('"this morning at 7am" resolves to a future 7am', async () => {
        const ts = await resolveTime('this morning at 7am');
        expect(ts).not.toBeNull();
        const d = new Date(ts);
        expect(d.getHours()).toBe(7);
        expect(ts).toBeGreaterThan(Date.now() - 1000);
    });

    // ── 24-hour clock format ─────────────────────────────────────────────────
    test('parseClockTime parses "21:00" (24h format)', () => {
        const ts = parseClockTime('21:00');
        expect(ts).not.toBeNull();
        const d = new Date(ts);
        expect(d.getHours()).toBe(21);
        expect(d.getMinutes()).toBe(0);
        expect(ts).toBeGreaterThan(Date.now() - 1000);
    });

    test('parseClockTime parses "08:30" (24h format with leading zero)', () => {
        const ts = parseClockTime('08:30');
        expect(ts).not.toBeNull();
        const d = new Date(ts);
        expect(d.getHours()).toBe(8);
        expect(d.getMinutes()).toBe(30);
    });

    test('resolveTime handles "21:00" via clock parsing', async () => {
        const ts = await resolveTime('21:00');
        expect(ts).not.toBeNull();
        const d = new Date(ts);
        expect(d.getHours()).toBe(21);
    });

    // ── Next-occurrence bumping ───────────────────────────────────────────────
    test('parseClockTime bumps to tomorrow when clock time has already passed today', () => {
        // Set up a time that is definitely in the past today
        // by parsing midnight (00:00) — always in the past if it's not midnight right now
        const ts = parseClockTime('00:01'); // 12:01am
        // It should be in the future (bumped to tomorrow's 00:01)
        expect(ts).toBeGreaterThan(Date.now() - 1000);
    });

    // ── Week resolution ───────────────────────────────────────────────────────
    test('"in 1 week" resolves approximately 7 days from now', async () => {
        const before = Date.now();
        const ts = await resolveTime('in 1 week');
        expect(ts).toBeGreaterThan(before + 6.9 * 86_400_000);
        expect(ts).toBeLessThan(before + 7.1 * 86_400_000);
    });

    // ── Edge cases ───────────────────────────────────────────────────────────
    test('returns null for empty string', async () => {
        const ts = await resolveTime('');
        expect(ts).toBeNull();
    });

    test('returns null for null input', async () => {
        const ts = await resolveTime(null);
        expect(ts).toBeNull();
    });

    test('returns null for pure nonsense (LLM fallback also fails)', async () => {
        const ts = await resolveTime('xyzzy frobozz grue');
        expect(ts).toBeNull();
    });
});
