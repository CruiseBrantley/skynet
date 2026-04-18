const logger = require('../logger');

/**
 * Fast-path regex patterns for common time expressions.
 * These are resolved locally without any LLM call.
 */
const PATTERNS = [
    // "in X minutes"
    { re: /\bin\s+(\d+)\s+min(?:ute)?s?\b/i, resolve: (m) => Date.now() + parseInt(m[1]) * 60_000 },
    // "in X hours"
    { re: /\bin\s+(\d+)\s+hours?\b/i, resolve: (m) => Date.now() + parseInt(m[1]) * 3_600_000 },
    // "in X days"
    { re: /\bin\s+(\d+)\s+days?\b/i, resolve: (m) => Date.now() + parseInt(m[1]) * 86_400_000 },
    // "in X weeks"
    { re: /\bin\s+(\d+)\s+weeks?\b/i, resolve: (m) => Date.now() + parseInt(m[1]) * 604_800_000 },
    // "tomorrow" — 24 hours from now
    { re: /\btomorrow\b/i, resolve: () => Date.now() + 86_400_000 },
    // "tonight" — today at 9pm, or tomorrow's 9pm if already past
    {
        re: /\btonight\b/i, resolve: () => {
            const d = new Date();
            d.setHours(21, 0, 0, 0);
            return d.getTime() <= Date.now() ? d.getTime() + 86_400_000 : d.getTime();
        }
    },
    // "this evening"
    {
        re: /\bthis evening\b/i, resolve: () => {
            const d = new Date();
            d.setHours(19, 0, 0, 0);
            return d.getTime() <= Date.now() ? d.getTime() + 86_400_000 : d.getTime();
        }
    },
    // "this morning"
    {
        re: /\bthis morning\b/i, resolve: () => {
            const d = new Date();
            d.setHours(8, 0, 0, 0);
            return d.getTime() <= Date.now() ? d.getTime() + 86_400_000 : d.getTime();
        }
    },
];

/**
 * Parse a clock time expression like "9pm", "9:30 AM", "21:00".
 * Returns a Unix ms timestamp for the next occurrence of that time, or null.
 */
function parseClockTime(str) {
    // 12-hour: "9pm", "9:30pm", "9:30 AM"
    const m12 = str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (m12) {
        let h = parseInt(m12[1]);
        const min = parseInt(m12[2] || '0');
        const ampm = m12[3].toLowerCase();
        if (ampm === 'pm' && h < 12) h += 12;
        if (ampm === 'am' && h === 12) h = 0;
        const d = new Date();
        d.setHours(h, min, 0, 0);
        // If the time has already passed today, use tomorrow's occurrence
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
        return d.getTime();
    }

    // 24-hour: "21:00", "09:30"
    const m24 = str.match(/\b(\d{1,2}):(\d{2})\b/);
    if (m24) {
        const d = new Date();
        d.setHours(parseInt(m24[1]), parseInt(m24[2]), 0, 0);
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
        return d.getTime();
    }

    return null;
}

/**
 * Resolve a natural language time expression to a Unix ms timestamp.
 * Tries fast regex patterns first; falls back to the local/remote Ollama
 * for complex expressions (never uses Gemini — this may be called by the agent loop).
 *
 * @param {string} naturalLanguage - e.g. "tonight at 9pm", "in 30 minutes", "next Friday"
 * @returns {Promise<number|null>} - Unix ms timestamp, or null if unresolvable
 */
async function resolveTime(naturalLanguage) {
    if (!naturalLanguage) return null;
    const input = naturalLanguage.trim();

    // Fast path 1: named patterns
    for (const { re, resolve } of PATTERNS) {
        const m = input.match(re);
        if (m) {
            // Also check for a clock time within the same expression, e.g. "tonight at 9pm"
            const clock = parseClockTime(input);
            if (clock) return clock;
            return resolve(m);
        }
    }

    // Fast path 2: bare clock time
    const clock = parseClockTime(input);
    if (clock) return clock;

    // Slow path: LLM for complex natural language ("next Friday", "end of the week", etc.)
    logger.info(`AgentClock: Falling back to LLM for time resolution: "${naturalLanguage}"`);
    try {
        const { queryLocalOrRemote } = require('./ollama');
        const now = new Date().toISOString();
        const result = await queryLocalOrRemote('/api/chat', {
            messages: [
                {
                    role: 'system',
                    content: `You are a precise time parser. Convert the user's time expression to a Unix timestamp in milliseconds.\nCurrent time (ISO 8601): ${now}\nRespond with ONLY valid JSON, nothing else: {"timestamp": 1713400000000}\nThe timestamp must be in the future relative to the current time.`
                },
                {
                    role: 'user',
                    content: `Time expression: "${naturalLanguage}"`
                }
            ]
        });

        const content = result?.message?.content || '';
        const match = content.match(/\{[^}]*"timestamp"\s*:\s*(\d{10,13})[^}]*\}/);
        if (match) {
            let ts = parseInt(match[1]);
            // Handle seconds vs milliseconds
            if (ts < 1e12) ts *= 1000;
            if (ts > Date.now()) return ts;
        }
    } catch (e) {
        logger.warn(`AgentClock: LLM time resolution failed: ${e.message}`);
    }

    return null;
}

module.exports = { resolveTime, parseClockTime };
