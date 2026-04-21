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
    // Days of the week (Monday, Tuesday, next Friday, sat, etc.)
    {
        re: /\b(?:(this|next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i,
        resolve: (m) => {
            const isNext = m[1] && m[1].toLowerCase() === 'next';
            const dayStr = m[2].toLowerCase();
            const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const shortDays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
            
            let target = days.indexOf(dayStr);
            if (target === -1) target = shortDays.indexOf(dayStr);
            
            const d = new Date();
            const current = d.getDay();
            let diff = target - current;
            
            if (isNext) {
                diff += 7;
            } else if (diff <= 0) {
                diff += 7;
            }
            
            d.setDate(d.getDate() + diff);
            d.setHours(9, 0, 0, 0); // Default to 9 AM
            return d.getTime();
        }
    }
];

/**
 * Parse a clock time expression like "9pm", "9:30 AM", "21:00".
 * Returns a Unix ms timestamp for the next occurrence of that time, or null.
 */
function parseClockTime(str, baseTimestamp = Date.now()) {
    // 12-hour: "9pm", "9:30pm", "9:30 AM"
    const m12 = str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (m12) {
        let h = parseInt(m12[1]);
        const min = parseInt(m12[2] || '0');
        const ampm = m12[3].toLowerCase();
        if (ampm === 'pm' && h < 12) h += 12;
        if (ampm === 'am' && h === 12) h = 0;
        const d = new Date(baseTimestamp);
        d.setHours(h, min, 0, 0);
        // If the time has already passed relative to the base, use tomorrow/next occurrence
        if (d.getTime() <= baseTimestamp) d.setDate(d.getDate() + 1);
        return d.getTime();
    }

    // 24-hour: "21:00", "09:30"
    const m24 = str.match(/\b(\d{1,2}):(\d{2})\b/);
    if (m24) {
        const d = new Date(baseTimestamp);
        d.setHours(parseInt(m24[1]), parseInt(m24[2]), 0, 0);
        if (d.getTime() <= baseTimestamp) d.setDate(d.getDate() + 1);
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
            const baseDate = resolve(m);
            // Check for a clock time within the same expression, e.g. "Saturday at 5pm"
            const clock = parseClockTime(input, baseDate);
            if (clock) {
                // If it was a day-of-week, we want the time on THAT day, 
                // so we verify if parseClockTime accidentally bumped it to the NEXT day
                const dClock = new Date(clock);
                const dBase = new Date(baseDate);
                if (dClock.getDate() !== dBase.getDate() && input.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)) {
                    dClock.setDate(dBase.getDate());
                    return dClock.getTime();
                }
                return clock;
            }
            return baseDate;
        }
    }

    // Fast path 2: bare clock time
    const clock = parseClockTime(input);
    if (clock) return clock;

    // Slow path: LLM for complex natural language ("next Friday", "end of the week", etc.)
    logger.info(`AgentClock: Falling back to LLM for time resolution: "${naturalLanguage}"`);
    try {
        const { queryLocalOrRemote } = require('./ollama');
        const now = new Date();
        const nowISO = now.toISOString();
        const dow = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
        const result = await queryLocalOrRemote('/api/chat', {
            messages: [
                {
                    role: 'system',
                    content: `You are a precise time parser. Convert the user's time expression to a Unix timestamp in milliseconds.
Current time: ${nowISO} (${dow})
Respond with ONLY valid JSON: {"timestamp": 1713400000000}
The timestamp must be in the future relative to the current time.`
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
