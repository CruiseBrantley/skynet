const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const { queryLocalOrRemote } = require('./ollama');
const { jsonrepair } = require('jsonrepair');

const BUILTIN_DIR = path.join(__dirname, 'actions');
const CUSTOM_DIR = path.join(__dirname, '../data/agent_actions');

/**
 * Patterns that are NEVER allowed in AI-generated action code.
 * Any match causes the registration to be rejected.
 */
const FORBIDDEN_PATTERNS = [
    /require\s*\(\s*['"`]fs['"`]\s*\)/,
    /require\s*\(\s*['"`]child_process['"`]\s*\)/,
    /require\s*\(\s*['"`]os['"`]\s*\)/,
    /require\s*\(\s*['"`]net['"`]\s*\)/,
    /require\s*\(\s*['"`]http['"`]\s*\)/,
    /require\s*\(\s*['"`]https['"`]\s*\)/,
    /process\s*\.\s*(env|exit|kill|binding)/,
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /\b__dirname\b/,
    /\b__filename\b/,
    /\.exec\s*\(/,
    /\.spawn\s*\(/,
    /\.execSync\s*\(/,
];

/**
 * ActionExecutor — loads built-in and AI-generated Discord actions,
 * classifies task intent via local Ollama, and executes the appropriate action.
 */
class ActionExecutor {
    constructor() {
        this._actions = {};
        this._loadBuiltins();
        this._loadCustom();
    }

    // ─── Loading ────────────────────────────────────────────────────────────────

    _loadBuiltins() {
        if (!fs.existsSync(BUILTIN_DIR)) return;
        for (const file of fs.readdirSync(BUILTIN_DIR).filter(f => f.endsWith('.js'))) {
            try {
                const fullPath = path.join(BUILTIN_DIR, file);
                const action = require(fullPath);
                this._actions[action.name] = action;
                logger.info(`ActionExecutor: Loaded built-in action "${action.name}"`);
            } catch (e) {
                logger.error(`ActionExecutor: Failed to load built-in "${file}": ${e.message}`);
            }
        }
    }

    _loadCustom() {
        if (!fs.existsSync(CUSTOM_DIR)) return;
        for (const file of fs.readdirSync(CUSTOM_DIR).filter(f => f.endsWith('.js'))) {
            try {
                const fullPath = path.join(CUSTOM_DIR, file);
                // Clear cache so hot-reload works without restart
                delete require.cache[require.resolve(fullPath)];
                const action = require(fullPath);
                this._actions[action.name] = action;
                logger.info(`ActionExecutor: Loaded custom action "${action.name}"`);
            } catch (e) {
                logger.error(`ActionExecutor: Failed to load custom "${file}": ${e.message}`);
            }
        }
    }

    listActions() {
        return Object.values(this._actions).map(a => ({
            name: a.name,
            description: a.description,
            schema: a.schema
        }));
    }

    // ─── Classification ──────────────────────────────────────────────────────────

    /**
     * Use local Ollama to classify a task description into an action + params.
     * Also extracts any Discord channel mention as a channel ID override.
     * @param {object} task
     * @returns {Promise<{ action: string, params: object, override_channel_id?: string }>}
     */
    async classify(task) {
        const actionList = this.listActions()
            .map(a => `- ${a.name}: ${a.description}\n  Schema: ${JSON.stringify(a.schema)}`)
            .join('\n');

        const prompt = `You are a Discord bot action classifier. Given a scheduled task description, select the most appropriate action and extract its parameters.

Available Actions:
${actionList}

Task Description: "${task.description}"

Rules:
1. Choose the MOST APPROPRIATE action from the list.
2. Extract ALL required parameters from the description.
3. If the description contains a Discord channel mention like <#1234567890>, extract the numeric channel ID as "override_channel_id".
4. Respond with ONLY a JSON object. No explanation, no markdown.

Example output:
{"action":"send_poll","override_channel_id":"580867049006301214","params":{"question":"Who is attending?","options":["Yes","No","Maybe"],"duration_hours":24}}`;

        try {
            const result = await queryLocalOrRemote('/api/chat', {
                messages: [
                    { role: 'system', content: 'You output only valid JSON. No markdown, no explanation.' },
                    { role: 'user', content: prompt }
                ]
            });

            const raw = result?.message?.content?.trim() || '';
            const firstBrace = raw.indexOf('{');
            const lastBrace = raw.lastIndexOf('}');
            if (firstBrace === -1 || lastBrace === -1) throw new Error('No JSON object in response');
            return JSON.parse(jsonrepair(raw.substring(firstBrace, lastBrace + 1)));
        } catch (e) {
            logger.warn(`ActionExecutor: Classification failed (${e.message}). Falling back to send_message.`);
            // Extract channel mentions even on fallback
            const channelMatch = task.description.match(/<#(\d+)>/);
            return {
                action: 'send_message',
                override_channel_id: channelMatch?.[1] || null,
                params: { content: task.description.replace(/<#\d+>/g, '').trim() }
            };
        }
    }

    // ─── Channel Resolution ──────────────────────────────────────────────────────

    /**
     * Resolve the Discord channel/DM to deliver to.
     * @param {import('discord.js').Client} bot
     * @param {object} task
     * @param {string|null} overrideChannelId - Takes priority over task.channelId if present
     */
    async resolveChannel(bot, task, overrideChannelId) {
        const channelId = overrideChannelId || task.channelId;

        if (channelId === 'dm' && task.userId) {
            const user = await bot.users.fetch(task.userId).catch(() => null);
            return user ? user.createDM().catch(() => null) : null;
        }

        if (channelId && channelId !== 'dm') {
            return bot.channels.cache.get(channelId)
                || await bot.channels.fetch(channelId).catch(() => null);
        }

        return null;
    }

    // ─── Execution ───────────────────────────────────────────────────────────────

    /**
     * Classify and execute a scheduled task using the appropriate action.
     * @param {import('discord.js').Client} bot
     * @param {object} task
     * @returns {Promise<boolean>} Whether delivery succeeded
     */
    async execute(bot, task) {
        // Hot-reload custom actions before every execution
        this._loadCustom();

        const classified = await this.classify(task);
        logger.info(`ActionExecutor: Task "${task.id}" → action="${classified.action}" channel_override="${classified.override_channel_id || 'none'}"`);

        let action = this._actions[classified.action];
        if (!action) {
            logger.warn(`ActionExecutor: Unknown action "${classified.action}" — falling back to send_message`);
            action = this._actions['send_message'];
            if (!action) {
                logger.error('ActionExecutor: send_message fallback missing. Cannot deliver.');
                return false;
            }
            classified.params = { content: task.description };
        }

        const channel = await this.resolveChannel(bot, task, classified.override_channel_id);
        if (!channel) {
            logger.warn(`ActionExecutor: Could not resolve delivery channel for task ${task.id}`);
            return false;
        }

        try {
            await action.execute(bot, channel, classified.params || {});
            logger.info(`ActionExecutor: Successfully executed "${classified.action}" for task ${task.id} in channel ${channel.id || 'DM'}`);
            return true;
        } catch (err) {
            logger.error(`ActionExecutor: Action "${classified.action}" threw an error for task ${task.id}: ${err.message}`);
            return false;
        }
    }

    // ─── Action Registration (AI-generated) ─────────────────────────────────────

    /**
     * Register a new AI-generated action. Validates code safety before saving to disk.
     * @param {string} name - Lowercase alphanumeric identifier
     * @param {string} description - Human-readable description for the classifier
     * @param {object} schema - Parameter descriptions
     * @param {string} code - The function body (will be wrapped in async (bot, channel, params) => { })
     * @returns {{ success: boolean, error?: string }}
     */
    registerAction(name, description, schema, code) {
        // Structural safety check for known problematic patterns (like the poll_media abstraction mismatch)
        if (code.includes('poll_media:')) {
            return { success: false, error: 'Structural Error: Native polls must use the flat { text: "..." } structure for answers, NOT the nested poll_media wrapper. Fix the code and retry.' };
        }

        // Validate name format
        if (!/^[a-z][a-z0-9_]{1,49}$/.test(name)) {
            return { success: false, error: 'Name must be 2–50 lowercase alphanumeric chars/underscores, starting with a letter.' };
        }

        // Never overwrite built-ins
        if (fs.existsSync(path.join(BUILTIN_DIR, `${name}.js`))) {
            return { success: false, error: `"${name}" is a protected built-in action and cannot be overwritten.` };
        }

        // Security scan
        for (const pattern of FORBIDDEN_PATTERNS) {
            if (pattern.test(code)) {
                const hit = code.match(pattern)?.[0];
                logger.warn(`ActionExecutor: Rejected action "${name}" — forbidden pattern: "${hit}"`);
                return { success: false, error: `Forbidden operation detected: "${hit}". Only Discord.js APIs are allowed.` };
            }
        }

        // Validate syntax — wrap in async since execute is always async
        try {
            new Function('bot', 'channel', 'params', `return (async (bot, channel, params) => { ${code} })(bot, channel, params);`); // eslint-disable-line no-new-func
        } catch (e) {
            return { success: false, error: `Syntax error in action code: ${e.message}` };
        }

        // Write to disk
        if (!fs.existsSync(CUSTOM_DIR)) fs.mkdirSync(CUSTOM_DIR, { recursive: true });

        const fileContent = `// Auto-generated action: ${name}
// Created: ${new Date().toISOString()}
// Description: ${description}
// WARNING: This file was generated by the Skynet AgentLoop. Edit with caution.

module.exports = {
    name: ${JSON.stringify(name)},
    description: ${JSON.stringify(description)},
    schema: ${JSON.stringify(schema, null, 4)},
    execute: async (bot, channel, params) => {
${code.split('\n').map(l => '        ' + l).join('\n')}
    }
};
`;

        const filePath = path.join(CUSTOM_DIR, `${name}.js`);
        fs.writeFileSync(filePath, fileContent);

        // Immediately load without restart
        try {
            delete require.cache[require.resolve(filePath)];
            const action = require(filePath);
            this._actions[action.name] = action;
            logger.info(`ActionExecutor: Registered and loaded new custom action "${name}"`);
            return { success: true };
        } catch (e) {
            fs.unlinkSync(filePath); // Roll back the file on load failure
            return { success: false, error: `Action registered but failed to load: ${e.message}` };
        }
    }

    /**
     * Modify an existing AI-generated action. Supports partial updates:
     * only the fields provided (description, schema, code) are updated.
     * Built-in actions cannot be modified.
     * @param {string} name
     * @param {{ description?: string, schema?: object, code?: string }} updates
     * @returns {{ success: boolean, error?: string }}
     */
    modifyAction(name, updates) {
        if (fs.existsSync(path.join(BUILTIN_DIR, `${name}.js`))) {
            return { success: false, error: `"${name}" is a built-in action and cannot be modified.` };
        }

        const filePath = path.join(CUSTOM_DIR, `${name}.js`);
        if (!fs.existsSync(filePath)) {
            return { success: false, error: `No custom action named "${name}" found. Use create_action to create it first.` };
        }

        // Load the current version
        let current;
        try {
            delete require.cache[require.resolve(filePath)];
            current = require(filePath);
        } catch (e) {
            return { success: false, error: `Could not load existing action "${name}": ${e.message}` };
        }

        // Merge: only override what was provided
        const newDescription = updates.description ?? current.description;
        const newSchema = updates.schema ?? current.schema;
        const newCode = updates.code;

        // Extract existing code from the file if no new code provided
        let codeToValidate = newCode;
        if (!codeToValidate) {
            // Re-use existing execute body — extract it from file text
            const raw = fs.readFileSync(filePath, 'utf8');
            const match = raw.match(/execute:\s*async\s*\(bot,\s*channel,\s*params\)\s*=>\s*\{([\s\S]*?)\n    \}\n\};/);
            codeToValidate = match ? match[1].trim() : '';
        }

        // Security and Structural scan on new code (if provided)
        if (updates.code) {
            if (updates.code.includes('poll_media:')) {
                return { success: false, error: 'Structural Error: Native polls must use the flat { text: "..." } structure for answers, NOT the nested poll_media wrapper. Fix the code and retry.' };
            }
            for (const pattern of FORBIDDEN_PATTERNS) {
                if (pattern.test(updates.code)) {
                    const hit = updates.code.match(pattern)?.[0];
                    logger.warn(`ActionExecutor: Rejected modify "${name}" — forbidden pattern: "${hit}"`);
                    return { success: false, error: `Forbidden operation detected: "${hit}". Only Discord.js APIs are allowed.` };
                }
            }
            // Validate syntax — wrap in async since execute is always async
            try {
                new Function('bot', 'channel', 'params', `return (async (bot, channel, params) => { ${updates.code} })(bot, channel, params);`); // eslint-disable-line no-new-func
            } catch (e) {
                return { success: false, error: `Syntax error in updated code: ${e.message}` };
            }
        }

        const fileContent = `// Auto-generated action: ${name}
// Last modified: ${new Date().toISOString()}
// Description: ${newDescription}
// WARNING: This file was generated by the Skynet AgentLoop. Edit with caution.

module.exports = {
    name: ${JSON.stringify(name)},
    description: ${JSON.stringify(newDescription)},
    schema: ${JSON.stringify(newSchema, null, 4)},
    execute: async (bot, channel, params) => {
${codeToValidate.split('\n').map(l => '        ' + l).join('\n')}
    }
};
`;

        fs.writeFileSync(filePath, fileContent);

        try {
            delete require.cache[require.resolve(filePath)];
            const action = require(filePath);
            this._actions[action.name] = action;
            logger.info(`ActionExecutor: Modified and reloaded custom action "${name}"`);
            return { success: true };
        } catch (e) {
            return { success: false, error: `Action saved but failed to reload: ${e.message}` };
        }
    }

    /**
     * Delete a custom AI-generated action by name.
     * Built-ins cannot be deleted.
     * @param {string} name
     * @returns {{ success: boolean, error?: string }}
     */
    deleteAction(name) {
        if (fs.existsSync(path.join(BUILTIN_DIR, `${name}.js`))) {
            return { success: false, error: `"${name}" is a built-in action and cannot be deleted.` };
        }
        const filePath = path.join(CUSTOM_DIR, `${name}.js`);
        if (!fs.existsSync(filePath)) {
            return { success: false, error: `No custom action named "${name}" found.` };
        }
        fs.unlinkSync(filePath);
        delete this._actions[name];
        logger.info(`ActionExecutor: Deleted custom action "${name}"`);
        return { success: true };
    }

    /**
     * Directly execute an action by name with params and a Discord context.
     * @param {string} name - Action name
     * @param {object} params - Action parameters
     * @param {object} context - Object with { client, channel } or a Discord Interaction
     * @returns {Promise<{ success: boolean, error?: string }>}
     */
    async executeAction(name, params, context) {
        let action = this._actions[name];
        if (!action) return { success: false, error: `unknown action: ${name}` };

        // Compatibility layer: handle interaction, bot object, or specific client/channel keys
        const bot = context.client || context.bot || context;
        let channel = context.channel || context;

        // Support channel override in params (ID, mention, or NAME)
        const channelInput = (params.channel || params.channelId || "").toString();
        const targetId = channelInput.replace(/[<#>]/g, '');
        
        if (targetId && bot.channels) {
            // Priority 1: Direct ID lookup
            let resolved = bot.channels.cache.get(targetId) || await bot.channels.fetch(targetId).catch(() => null);
            
            // Priority 2: Name lookup (if in a guild)
            if (!resolved && context.guild && context.guild.channels) {
                resolved = context.guild.channels.cache.find(c => 
                    c.name.toLowerCase() === targetId.toLowerCase() || 
                    c.name.toLowerCase() === channelInput.toLowerCase()
                );
            }

            if (resolved) channel = resolved;
        }

        try {
            await action.execute(bot, channel, params || {}, context);
            return { success: true };
        } catch (err) {
            logger.error(`ActionExecutor: Action "${name}" failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    }
}

module.exports = new ActionExecutor();
