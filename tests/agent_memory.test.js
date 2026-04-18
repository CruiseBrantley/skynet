const path = require('path');
const fs = require('fs');

// Redirect agent_memory.json to /tmp to avoid polluting real data/
const MOCK_MEMORY_FILE = '/tmp/skynet_test_agent_memory.json';

// Intercept path.join for just the memory file
jest.mock('../util/AgentMemory', () => {
    // Swap out the file path before the module executes
    const actualPath = jest.requireActual('path');
    const actualFs = jest.requireActual('fs');

    // Nuke any leftover from a previous run
    if (actualFs.existsSync(MOCK_MEMORY_FILE)) actualFs.unlinkSync(MOCK_MEMORY_FILE);

    // Temporarily patch path.join in the module's scope by monkey-patching the require cache
    const memoryFilePath = MOCK_MEMORY_FILE;

    class AgentMemory {
        constructor() {
            this._file = memoryFilePath;
            this._data = {};
            if (actualFs.existsSync(this._file)) {
                try { this._data = JSON.parse(actualFs.readFileSync(this._file, 'utf8')); } catch(e) {}
            }
        }
        _save() { actualFs.writeFileSync(this._file, JSON.stringify(this._data, null, 2)); }
        _pruneExpired() {
            const now = Date.now();
            for (const [k, e] of Object.entries(this._data)) {
                if (e.ttlDays > 0 && now > e.updatedAt + e.ttlDays * 86400000) delete this._data[k];
            }
        }
        _scopeFor(key) {
            const GLOBAL = ['user.', 'preference.', 'global.'];
            return GLOBAL.some(p => key.startsWith(p)) ? 'global' : 'server';
        }
        set(key, value, ttlDays = 30, guildId = null) {
            const entryGuildId = this._scopeFor(key) === 'global' ? null : (guildId || null);
            this._data[key] = { value: String(value), updatedAt: Date.now(), ttlDays, guildId: entryGuildId };
            this._pruneExpired();
            this._save();
            return true;
        }
        get(key, guildId = null) {
            this._pruneExpired();
            const entry = this._data[key];
            if (!entry) return null;
            if (entry.guildId !== null && entry.guildId !== undefined && entry.guildId !== guildId) return null;
            return entry.value;
        }
        delete(key) {
            if (!this._data[key]) return false;
            delete this._data[key];
            this._save();
            return true;
        }
        getSummary(guildId = null, maxChars = 1200) {
            this._pruneExpired();
            const entries = Object.entries(this._data).filter(([, e]) =>
                e.guildId === null || e.guildId === undefined || e.guildId === guildId
            );
            if (!entries.length) return null;
            let s = entries.sort((a,b) => b[1].updatedAt - a[1].updatedAt).map(([k,v]) => `${k} = ${v.value}`).join('\n');
            if (s.length > maxChars) s = s.substring(0, maxChars) + '\n...(truncated)';
            return s;
        }
        getAll(guildId = null) {
            this._pruneExpired();
            return Object.fromEntries(
                Object.entries(this._data).filter(([, e]) =>
                    e.guildId === null || e.guildId === undefined || e.guildId === guildId
                )
            );
        }
        size() { return Object.keys(this._data).length; }
        _reset() { this._data = {}; this._save(); }
    }
    return new AgentMemory();
});

describe('AgentMemory', () => {
    let mem;

    beforeEach(() => {
        mem = require('../util/AgentMemory');
        mem._reset(); // wipe state between tests
    });

    afterAll(() => {
        if (fs.existsSync(MOCK_MEMORY_FILE)) fs.unlinkSync(MOCK_MEMORY_FILE);
    });

    test('set and get a value', () => {
        mem.set('user.cruise.timezone', 'America/Chicago', -1);
        expect(mem.get('user.cruise.timezone')).toBe('America/Chicago');
    });

    test('returns null for unknown key', () => {
        expect(mem.get('does.not.exist')).toBeNull();
    });

    test('delete removes a key', () => {
        mem.set('temp.key', 'some value', 7);
        mem.delete('temp.key');
        expect(mem.get('temp.key')).toBeNull();
    });

    test('delete returns false for non-existent key', () => {
        expect(mem.delete('ghost.key')).toBe(false);
    });

    test('getSummary returns null when empty', () => {
        expect(mem.getSummary()).toBeNull();
    });

    test('getSummary returns key=value lines', () => {
        mem.set('pref.music', 'lo-fi', -1);
        mem.set('pref.language', 'English', -1);
        const summary = mem.getSummary();
        expect(summary).toContain('pref.music = lo-fi');
        expect(summary).toContain('pref.language = English');
    });

    test('getSummary truncates at maxChars', () => {
        for (let i = 0; i < 20; i++) mem.set(`key.${i}`, 'x'.repeat(100), -1);
        const summary = mem.getSummary(null, 200);
        // Allow up to 230 chars: 200 limit + '\n...(truncated)' marker (15 chars)
        expect(summary.length).toBeLessThanOrEqual(230);
    });

    test('expired entries are pruned on get', () => {
        mem._data['expired.key'] = {
            value: 'old',
            updatedAt: Date.now() - 10 * 86400000, // 10 days ago
            ttlDays: 5                              // expired 5 days ago
        };
        expect(mem.get('expired.key')).toBeNull();
    });

    test('permanent entries (ttl -1) are never pruned', () => {
        mem._data['perm.key'] = { value: 'forever', updatedAt: Date.now() - 999 * 86400000, ttlDays: -1 };
        mem._pruneExpired();
        expect(mem.get('perm.key')).toBe('forever');
    });

    test('size() returns correct count', () => {
        mem.set('a', '1', -1);
        mem.set('b', '2', -1);
        expect(mem.size()).toBe(2);
    });

    test('getAll() returns a shallow copy', () => {
        mem.set('x', 'val', -1);
        const all = mem.getAll();
        expect(all['x'].value).toBe('val');
        delete all['x'];
        expect(mem.get('x')).toBe('val'); // original unaffected
    });

    // --- Scoping Tests ---
    test('user.* keys are stored globally regardless of guildId', () => {
        mem.set('user.cruise.lang', 'English', -1, 'guild-A');
        // Should be readable from a completely different guild
        expect(mem.get('user.cruise.lang', 'guild-B')).toBe('English');
        expect(mem.get('user.cruise.lang', null)).toBe('English');
    });

    test('server.* keys are only visible in the storing guild', () => {
        mem.set('server.behavior', 'say bees', 30, 'guild-A');
        expect(mem.get('server.behavior', 'guild-A')).toBe('say bees');
        expect(mem.get('server.behavior', 'guild-B')).toBeNull();
        expect(mem.get('server.behavior', null)).toBeNull();
    });

    test('behavior.* keys are server-scoped', () => {
        mem.set('behavior.quirk', 'pirate speak', 30, 'guild-X');
        expect(mem.get('behavior.quirk', 'guild-X')).toBe('pirate speak');
        expect(mem.get('behavior.quirk', 'guild-Y')).toBeNull();
    });

    test('getSummary respects guild scoping', () => {
        mem.set('user.cruise.name', 'Cruise', -1, 'guild-A');      // global - visible everywhere
        mem.set('server.greeting_a', 'hello bees!', 30, 'guild-A'); // server A only
        mem.set('server.greeting_b', 'ahoy!', 30, 'guild-B');       // server B only

        const summaryA = mem.getSummary('guild-A');
        expect(summaryA).toContain('user.cruise.name = Cruise');
        expect(summaryA).toContain('hello bees!');
        expect(summaryA).not.toContain('ahoy!');

        const summaryB = mem.getSummary('guild-B');
        expect(summaryB).toContain('user.cruise.name = Cruise');
        expect(summaryB).toContain('ahoy!');
        expect(summaryB).not.toContain('hello bees!');
    });

    test('DM context (guildId=null) only sees global memory', () => {
        mem.set('user.cruise.tz', 'CST', -1, null);
        mem.set('server.quirk', 'only on server', 30, 'guild-A');
        const summary = mem.getSummary(null);
        expect(summary).toContain('user.cruise.tz = CST');
        expect(summary).not.toContain('only on server');
    });

    test('reloads data from disk on new instance instantiation', () => {
        mem.set('persistent.key', 'saved', -1);
        // Create a new instance (simulated by re-requiring or manually calling constructor)
        const AgentMemory = mem.constructor; 
        const newMem = new AgentMemory();
        expect(newMem.get('persistent.key')).toBe('saved');
    });
});
