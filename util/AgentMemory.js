const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const DATA_DIR = path.join(__dirname, '../data');
const MEMORY_FILE = path.join(DATA_DIR, 'agent_memory.json');

// Max entries before oldest non-permanent entries are pruned
const MAX_ENTRIES = 500;

// Key prefixes that are always global (not tied to any guild)
const GLOBAL_PREFIXES = ['user.', 'preference.', 'global.'];

/**
 * Determine the scope of a key based on its prefix.
 * Returns 'global' or 'server'.
 */
function scopeFor(key) {
    for (const prefix of GLOBAL_PREFIXES) {
        if (key.startsWith(prefix)) return 'global';
    }
    return 'server'; // server.*, channel.*, behavior.*, or any unknown prefix
}

/**
 * Singleton long-term key/value memory store for the agent.
 * Persisted to local disk at data/agent_memory.json.
 * TTL-aware: entries expire after ttlDays. -1 = permanent.
 * Stays well under Firebase free tier — nothing is written to Firebase.
 */
class AgentMemory {
    constructor() {
        this._ensureDataDir();
        this._data = this._load();
    }

    _ensureDataDir() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            logger.info('AgentMemory: Created data/ directory for persistent storage.');
        }
    }

    _load() {
        try {
            if (fs.existsSync(MEMORY_FILE)) {
                return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
            }
        } catch (e) {
            logger.warn(`AgentMemory: Failed to load memory file, starting fresh: ${e.message}`);
        }
        return {};
    }

    _save() {
        try {
            fs.writeFileSync(MEMORY_FILE, JSON.stringify(this._data, null, 2));
        } catch (e) {
            logger.error(`AgentMemory: Failed to save memory: ${e.message}`);
        }
    }

    /**
     * Remove any entries whose TTL has expired.
     */
    _pruneExpired() {
        const now = Date.now();
        let pruned = 0;
        for (const [key, entry] of Object.entries(this._data)) {
            if (entry.ttlDays > 0) {
                const expiresAt = entry.updatedAt + (entry.ttlDays * 86400 * 1000);
                if (now > expiresAt) {
                    delete this._data[key];
                    pruned++;
                }
            }
        }
        if (pruned > 0) {
            logger.info(`AgentMemory: Pruned ${pruned} expired entries.`);
        }
    }

    /**
     * When we exceed MAX_ENTRIES, evict oldest non-permanent entries first.
     */
    _pruneOldest() {
        const entries = Object.entries(this._data);
        if (entries.length <= MAX_ENTRIES) return;

        const evictable = entries
            .filter(([, e]) => e.ttlDays !== -1)
            .sort((a, b) => a[1].updatedAt - b[1].updatedAt);

        const toRemove = entries.length - MAX_ENTRIES;
        for (let i = 0; i < toRemove && i < evictable.length; i++) {
            delete this._data[evictable[i][0]];
        }
        logger.info(`AgentMemory: Evicted ${Math.min(toRemove, evictable.length)} oldest entries to stay under MAX_ENTRIES.`);
    }

    /**
     * Store a value under a key.
     * @param {string} key - Namespaced key, e.g. "user.cruise.timezone" or "server.behavior"
     * @param {string} value - The value to store (always stored as string)
     * @param {number} ttlDays - Days until expiry. -1 = permanent.
     * @param {string|null} guildId - The Discord guild ID. Auto-determined from key prefix if null.
     */
    set(key, value, ttlDays = 30, guildId = null) {
        const scope = scopeFor(key);
        const entryGuildId = scope === 'global' ? null : (guildId || null);
        this._data[key] = {
            value: String(value),
            updatedAt: Date.now(),
            ttlDays,
            guildId: entryGuildId // null = global, string = server-specific
        };
        this._pruneExpired();
        this._pruneOldest();
        this._save();
        const scopeLabel = entryGuildId ? `guild:${entryGuildId}` : 'global';
        logger.info(`AgentMemory: Stored "${key}" [${scopeLabel}] (TTL: ${ttlDays === -1 ? 'permanent' : ttlDays + ' days'})`);
        return true;
    }

    /**
     * Retrieve the value for a key, respecting scope.
     * @param {string} key
     * @param {string|null} guildId - Current guild context for server-scoped keys.
     */
    get(key, guildId = null) {
        this._pruneExpired();
        const entry = this._data[key];
        if (!entry) return null;
        // If entry is server-scoped, only return it if we're in the right guild
        if (entry.guildId !== null && entry.guildId !== guildId) return null;
        return entry.value;
    }

    /**
     * Delete a key from memory.
     * @param {string} key
     */
    delete(key) {
        if (this._data[key]) {
            delete this._data[key];
            this._save();
            logger.info(`AgentMemory: Deleted "${key}"`);
            return true;
        }
        return false;
    }

    /**
     * Returns a compact, LLM-friendly summary of all memory visible in the current context.
     * Global entries are always included. Server-scoped entries are included only if guildId matches.
     * @param {string|null} guildId - Current guild ID (null for DMs — only global memory shown)
     * @param {number} maxChars
     */
    getSummary(guildId = null, maxChars = 1200) {
        this._pruneExpired();
        const entries = Object.entries(this._data).filter(([, e]) => {
            // Include global entries always
            if (e.guildId === null || e.guildId === undefined) return true;
            // Include server-scoped entries only if guildId matches current guild
            return e.guildId === guildId;
        });
        if (entries.length === 0) return null;

        const lines = entries
            .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
            .map(([k, v]) => `${k} = ${v.value}`);

        let summary = lines.join('\n');
        if (summary.length > maxChars) {
            summary = summary.substring(0, maxChars) + '\n...(truncated)';
        }
        return summary;
    }

    /**
     * Returns the raw data map, optionally filtered by guildId visibility.
     * @param {string|null} guildId - If provided, only entries visible in this guild are returned.
     */
    getAll(guildId = null) {
        this._pruneExpired();
        if (guildId === undefined) return { ...this._data }; // raw dump for diagnostics
        return Object.fromEntries(
            Object.entries(this._data).filter(([, e]) =>
                e.guildId === null || e.guildId === undefined || e.guildId === guildId
            )
        );
    }

    /**
     * Returns total number of stored entries.
     */
    size() {
        return Object.keys(this._data).length;
    }
}

module.exports = new AgentMemory();
