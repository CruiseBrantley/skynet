const logger = require('../logger');
const agentMemory = require('./AgentMemory');
const agentScheduler = require('./AgentScheduler');
const { queryLocalOrRemote } = require('./ollama');
const { jsonrepair } = require('jsonrepair');

// Max recursion depth per tick — prevents the model from chaining tool calls indefinitely
const MAX_LOOP_DEPTH = 5;

// Ring buffer size for recent agent actions (for the agent's own context)
const MAX_RECENT_ACTIONS = 20;

/**
 * Autonomous background agent loop.
 * Wakes on a configurable interval, evaluates the current state using local/remote Ollama,
 * and executes lightweight tool calls (memory, scheduling) as needed.
 *
 * Design constraints:
 * - NEVER calls Gemini — all inference via queryLocalOrRemote()
 * - Backs off if a tick is already running (no concurrent evaluations)
 * - Depth counter prevents runaway recursive tool chains
 * - Unknown or unsupported commands are silently ignored, never re-tried
 */
class AgentLoop {
    constructor() {
        this._interval = null;
        this._isRunning = false;
        this._lastRunAt = null;
        this._recentActions = []; // Ring buffer of recent decisions/actions
        this._bot = null;         // Discord client reference, injected on start()
        this._tickCount = 0;      // Total evaluations run
    }

    /**
     * Start the loop. Safe to call multiple times — won't create duplicate intervals.
     * @param {import('discord.js').Client} bot - The Discord client.
     * @param {number} intervalMs - Milliseconds between ticks. Default: 10 minutes.
     */
    start(bot, intervalMs = 10 * 60_000) {
        if (this._interval) {
            logger.info('AgentLoop: Already running — ignoring duplicate start().');
            return;
        }
        this._bot = bot;
        logger.info(`AgentLoop: Starting background evaluation loop (interval: ${intervalMs / 1000}s).`);

        // First tick fires after one full interval — let the bot finish initializing first.
        this._interval = setInterval(() => { this._tick(); }, intervalMs);
    }

    /**
     * Stop the loop gracefully.
     */
    stop() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
            logger.info('AgentLoop: Stopped.');
        }
    }

    /**
     * Trigger a manual evaluation immediately (e.g. for testing or external triggers).
     */
    async runOnce() {
        return this._tick();
    }

    // ─── Internal ───────────────────────────────────────────────────────────────

    async _tick() {
        if (this._isRunning) {
            logger.info('AgentLoop: Skipping tick — previous evaluation still in progress.');
            return;
        }
        this._isRunning = true;
        this._tickCount++;
        logger.info(`AgentLoop: Tick #${this._tickCount} started.`);
        try {
            await this._evaluate(0);
        } catch (err) {
            logger.error(`AgentLoop: Uncaught exception in tick: ${err.message}`);
        } finally {
            this._isRunning = false;
            this._lastRunAt = Date.now();
            logger.info(`AgentLoop: Tick #${this._tickCount} complete.`);
        }
    }

    async _evaluate(loopDepth) {
        if (loopDepth > MAX_LOOP_DEPTH) {
            logger.warn(`AgentLoop: MAX_LOOP_DEPTH (${MAX_LOOP_DEPTH}) reached — stopping recursion.`);
            return;
        }

        // ── Build context ──────────────────────────────────────────────────────
        const now = new Date().toLocaleString('en-US', { timeZoneName: 'short' });
        const memorySummary = agentMemory.getSummary(null, 800) || 'Empty';
        const tasks = agentScheduler.getAll();
        const recentActions = this._recentActions.slice(-5).join('\n') || 'None';

        const taskList = tasks.length > 0
            ? tasks.map(t =>
                `  - [${t.id}] "${t.description.substring(0, 80)}" → ${new Date(t.scheduledAt).toLocaleString()}${t.repeat ? ` (repeats ${t.repeat})` : ''} | target: ${t.channelId}`
              ).join('\n')
            : '  None';

        const actionExecutor = require('./ActionExecutor');
        const actionList = actionExecutor.listActions()
            .map(a => `  - ${a.name}: ${a.description}`)
            .join('\n') || '  None';

        const systemPrompt = `You are Skynet's autonomous background daemon agent.
Current time: ${now}

Your objective is to evaluate the current state and decide if any PROACTIVE action is needed.

[LONG-TERM MEMORY]
${memorySummary}

[SCHEDULED TASKS]
${taskList}

[RECENT AGENT ACTIONS]
${recentActions}

[AVAILABLE DISCORD ACTIONS]
These are the actions the scheduler can execute when tasks fire. You can create new ones.
${actionList}

Rules:
- If nothing requires action right now, respond with exactly: NOOP
- Only act if you have a clear, specific reason derived from the above data.
- Available commands: remember, forget, recall, schedule, cancel_task, create_action, delete_action
- Format: <<<RUN_COMMAND: {"command": "...", ...}>>>
- DO NOT attempt to search the web, play music, generate images, or send arbitrary messages.
- DO NOT schedule tasks speculatively — only if there is explicit context to do so.

create_action schema:
<<<RUN_COMMAND: {"command": "create_action", "name": "snake_case_name", "description": "What it does", "schema": {"param": "type — description"}, "code": "// discord.js code here\\nawait channel.send(params.content);"}>>>
- Only discord.js APIs allowed. No require('fs'), require('child_process'), process.env, or eval.
- Built-in actions (send_message, send_poll, send_embed, send_thread) cannot be overwritten.

delete_action schema:
<<<RUN_COMMAND: {"command": "delete_action", "name": "action_name"}>>>
- Only custom (AI-generated) actions can be deleted.

modify_action schema (all fields optional except name):
<<<RUN_COMMAND: {"command": "modify_action", "name": "existing_name", "description": "updated description", "code": "// new code"}>>>
- Only custom actions can be modified. Omit any field you don't want to change.

After your tool call, briefly explain WHY (one sentence). Example:
<<<RUN_COMMAND: {"command": "remember", "key": "server.last_health_check", "value": "2026-04-18", "ttl_days": 7}>>>
Reason: Recording health check timestamp for diagnostics.`;


        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Evaluate the current state. NOOP if nothing is needed.' }
        ];

        logger.info(`AgentLoop: Querying Ollama for evaluation (depth: ${loopDepth})...`);
        let result;
        try {
            result = await queryLocalOrRemote('/api/chat', { 
                messages,
                options: {
                    num_ctx: 8192,
                    temperature: 0.3
                }
            });
        } catch (err) {
            logger.error(`AgentLoop: Ollama query failed: ${err.message}`);
            return;
        }

        const content = result?.message?.content?.trim() || '';
        logger.info(`AgentLoop: Response (first 120 chars): "${content.substring(0, 120)}"`);

        if (!content || content.startsWith('NOOP')) {
            logger.info('AgentLoop: NOOP — no action taken.');
            return;
        }

        // ── Parse and execute tool call(s) ────────────────────────────────────
        const commandMatch = content.match(/<<<RUN_COMMAND:\s*([\s\S]*?)>>>/);
        if (!commandMatch) {
            logger.info(`AgentLoop: Response contained no valid RUN_COMMAND block — treating as NOOP.`);
            return;
        }

        try {
            const rawJson = commandMatch[1].trim();
            const firstBrace = rawJson.indexOf('{');
            if (firstBrace === -1) throw new Error('No JSON body found in RUN_COMMAND');
            const cmdData = JSON.parse(jsonrepair(rawJson.substring(firstBrace)));

            const actionDescription = await this._executeCommand(cmdData);
            if (actionDescription) {
                const entry = `[${now}] depth:${loopDepth} → ${actionDescription}`;
                this._recentActions.push(entry);
                if (this._recentActions.length > MAX_RECENT_ACTIONS) this._recentActions.shift();

                // Recurse to check if more action is needed after this one
                await this._evaluate(loopDepth + 1);
            }
        } catch (err) {
            logger.error(`AgentLoop: Failed to parse/execute command: ${err.message}`);
        }
    }

    /**
     * Execute a single background-safe command.
     * Returns a short description string for the action log, or null if unsupported/failed.
     */
    async _executeCommand(cmdData) {
        const { getParam } = require('./commandHelper');
        const cmd = (cmdData.command || '').trim();

        if (cmd === 'remember') {
            const key = getParam(cmdData, 'key');
            const value = getParam(cmdData, 'value');
            const ttl = parseInt(getParam(cmdData, 'ttl_days') ?? 30);
            if (!key || value === undefined) return null;
            agentMemory.set(key, String(value), ttl, null); // null guildId = global
            logger.info(`AgentLoop: [remember] ${key} = ${String(value).substring(0, 60)}`);
            return `remember: "${key}" = "${String(value).substring(0, 40)}"`;
        }

        if (cmd === 'forget') {
            const key = getParam(cmdData, 'key');
            if (!key) return null;
            agentMemory.delete(key);
            logger.info(`AgentLoop: [forget] ${key}`);
            return `forget: "${key}"`;
        }

        if (cmd === 'recall') {
            const key = getParam(cmdData, 'key');
            if (!key) return null;
            const val = agentMemory.get(key, null);
            logger.info(`AgentLoop: [recall] ${key} = ${val}`);
            // recall is read-only — don't re-evaluate, just log
            return `recall: "${key}" → "${val}"`;
        }

        if (cmd === 'schedule') {
            const { resolveTime } = require('./AgentClock');
            const message = getParam(cmdData, 'message');
            const when = getParam(cmdData, 'when');
            if (!message || !when) return null;
            const scheduledAt = await resolveTime(when);
            if (!scheduledAt) {
                logger.warn(`AgentLoop: Could not resolve time "${when}" for autonomous schedule.`);
                return null;
            }
            const task = agentScheduler.add({
                description: message,
                scheduledAt,
                userId: getParam(cmdData, 'userId') || null,
                guildId: getParam(cmdData, 'guildId') || null,
                channelId: getParam(cmdData, 'channelId') || 'dm',
                repeat: ['hourly', 'daily', 'weekly'].includes(getParam(cmdData, 'repeat')) ? getParam(cmdData, 'repeat') : null,
                createdBy: 'agent_loop'
            });
            logger.info(`AgentLoop: [schedule] Task ${task.id} → ${new Date(scheduledAt).toLocaleString()}`);
            return `schedule: "${message.substring(0, 40)}" at ${new Date(scheduledAt).toLocaleString()}`;
        }

        if (cmd === 'cancel_task') {
            const id = getParam(cmdData, 'id');
            if (!id) return null;
            const cancelled = agentScheduler.cancel(id);
            logger.info(`AgentLoop: [cancel_task] ${id} — ${cancelled ? 'succeeded' : 'not found'}`);
            return cancelled ? `cancel_task: ${id}` : null;
        }

        if (cmd === 'modify_action') {
            const actionExecutor = require('./ActionExecutor');
            const name = getParam(cmdData, 'name');
            if (!name) {
                logger.warn('AgentLoop: [modify_action] Missing required field: name');
                return null;
            }
            const updates = {};
            const desc = getParam(cmdData, 'description');
            const schema = getParam(cmdData, 'schema');
            const code = getParam(cmdData, 'code');
            
            if (desc) updates.description = desc;
            if (schema) updates.schema = schema;
            if (code) updates.code = code;
            
            if (Object.keys(updates).length === 0) {
                logger.warn('AgentLoop: [modify_action] No updates provided — nothing to change.');
                return null;
            }
            const result = actionExecutor.modifyAction(name, updates);
            if (result.success) {
                logger.info(`AgentLoop: [modify_action] Updated action "${name}"`);
                return `modify_action: "${name}" updated (fields: ${Object.keys(updates).join(', ')})`;
            } else {
                logger.warn(`AgentLoop: [modify_action] Failed: ${result.error}`);
                return null;
            }
        }

        if (cmd === 'create_action') {
            const actionExecutor = require('./ActionExecutor');
            const name = getParam(cmdData, 'name');
            const description = getParam(cmdData, 'description');
            const schema = getParam(cmdData, 'schema') || {};
            const code = getParam(cmdData, 'code');
            if (!name || !description || !code) {
                logger.warn('AgentLoop: [create_action] Missing required fields: name, description, code');
                return null;
            }
            const result = actionExecutor.registerAction(name, description, schema, code);
            if (result.success) {
                logger.info(`AgentLoop: [create_action] Registered new action "${name}"`);
                return `create_action: "${name}" registered successfully`;
            } else {
                logger.warn(`AgentLoop: [create_action] Failed to register "${name}": ${result.error}`);
                return null;
            }
        }

        if (cmd === 'delete_action') {
            const actionExecutor = require('./ActionExecutor');
            const name = getParam(cmdData, 'name');
            if (!name) return null;
            const result = actionExecutor.deleteAction(name);
            if (result.success) {
                logger.info(`AgentLoop: [delete_action] Removed action "${name}"`);
                return `delete_action: "${name}" removed`;
            } else {
                logger.warn(`AgentLoop: [delete_action] Failed: ${result.error}`);
                return null;
            }
        }

        logger.warn(`AgentLoop: Command "${cmd}" is not supported in background context — ignoring.`);
        return null;
    }


    /** Expose diagnostics for testing / admin inspection. */
    get status() {
        return {
            running: !!this._interval,
            isEvaluating: this._isRunning,
            tickCount: this._tickCount,
            lastRunAt: this._lastRunAt,
            recentActions: [...this._recentActions]
        };
    }
}

module.exports = new AgentLoop();
