const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const DATA_DIR = path.join(__dirname, '../data');
const TASKS_FILE = path.join(DATA_DIR, 'agent_tasks.json');

/**
 * Singleton persistent task scheduler.
 * Stores scheduled tasks to local disk at data/agent_tasks.json.
 * Nothing is written to Firebase — all content stays local.
 */
class AgentScheduler {
    constructor() {
        this._ensureDataDir();
        this._tasks = this._load();
    }

    _ensureDataDir() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    }

    _load() {
        try {
            if (fs.existsSync(TASKS_FILE)) {
                return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
            }
        } catch (e) {
            logger.warn(`AgentScheduler: Failed to load tasks: ${e.message}`);
        }
        return [];
    }

    _save() {
        try {
            fs.writeFileSync(TASKS_FILE, JSON.stringify(this._tasks, null, 2));
        } catch (e) {
            logger.error(`AgentScheduler: Failed to save tasks: ${e.message}`);
        }
    }

    /**
     * Add a new scheduled task.
     * @param {object} task
     * @param {string} task.description - The text message to send when task fires.
     * @param {number} task.scheduledAt - Unix ms timestamp to fire.
     * @param {string|null} task.userId - Discord user ID (for DM delivery or attribution).
     * @param {string|null} task.guildId - Discord guild ID (for channel delivery / context).
     * @param {string} task.channelId - "dm" to DM the user, or a Discord channel snowflake.
     * @param {string|null} task.repeat - null | "hourly" | "daily" | "weekly"
     * @param {string} task.createdBy - Username of creator.
     * @returns {object} The created task object (with id).
     */
    add(task) {
        const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const entry = {
            id,
            description: task.description,
            scheduledAt: task.scheduledAt,
            userId: task.userId || null,
            guildId: task.guildId || null,
            channelId: task.channelId || 'dm',
            repeat: task.repeat || null,
            createdAt: Date.now(),
            createdBy: task.createdBy || 'unknown'
        };
        this._tasks.push(entry);
        this._save();
        logger.info(`AgentScheduler: Scheduled task ${id} - "${task.description.substring(0, 60)}" at ${new Date(task.scheduledAt).toLocaleString()}`);
        return entry;
    }

    /**
     * Get all tasks that are due at or before now.
     * @returns {object[]}
     */
    getDue() {
        const now = Date.now();
        return this._tasks.filter(t => t.scheduledAt <= now);
    }

    /**
     * Mark a one-shot task complete and remove it.
     * @param {string} id
     */
    complete(id) {
        const before = this._tasks.length;
        this._tasks = this._tasks.filter(t => t.id !== id);
        if (this._tasks.length < before) {
            this._save();
            logger.info(`AgentScheduler: Completed and removed task ${id}.`);
        }
    }

    /**
     * For repeating tasks: advance the scheduledAt to the next interval.
     * @param {string} id
     */
    reschedule(id) {
        const task = this._tasks.find(t => t.id === id);
        if (!task || !task.repeat) return;

        const intervals = { hourly: 3_600_000, daily: 86_400_000, weekly: 604_800_000 };
        const interval = intervals[task.repeat];
        if (interval) {
            task.scheduledAt += interval;
            this._save();
            logger.info(`AgentScheduler: Rescheduled task ${id} → ${new Date(task.scheduledAt).toLocaleString()}`);
        }
    }

    /**
     * Cancel a task by ID, regardless of whether it's due.
     * @param {string} id
     * @returns {boolean} Whether a task was found and removed.
     */
    cancel(id) {
        const before = this._tasks.length;
        this._tasks = this._tasks.filter(t => t.id !== id);
        if (this._tasks.length < before) {
            this._save();
            logger.info(`AgentScheduler: Cancelled task ${id}.`);
            return true;
        }
        return false;
    }

    /**
     * Get all tasks (for display / diagnostics).
     */
    getAll() {
        return [...this._tasks];
    }

    /**
     * Get all tasks created by or targeted to a specific Discord user.
     * @param {string} userId
     */
    getByUser(userId) {
        return this._tasks.filter(t => t.userId === userId);
    }

    /**
     * Process all due tasks and deliver them via the Discord bot.
     * @param {import('discord.js').Client} bot 
     */
    async processDueTasks(bot) {
        const dueTasks = this.getDue();
        for (const task of dueTasks) {
            try {
                let delivered = false;
                if (task.channelId === 'dm' && task.userId) {
                    const user = await bot.users.fetch(task.userId).catch(() => null);
                    if (user) {
                        await user.send(task.description);
                        logger.info(`AgentScheduler: DM sent to ${task.userId}: "${task.description.substring(0, 60)}"`);
                        delivered = true;
                    }
                } else if (task.channelId && task.channelId !== 'dm') {
                    const channel = bot.channels.cache.get(task.channelId);
                    if (channel) {
                        await channel.send(task.description);
                        logger.info(`AgentScheduler: Message sent to channel ${task.channelId}.`);
                        delivered = true;
                    }
                }
                
                if (!delivered) {
                    logger.warn(`AgentScheduler: Could not deliver task ${task.id} — user/channel not found.`);
                }

                // Advance repeating tasks; clean up one-shots
                if (task.repeat) {
                    this.reschedule(task.id);
                } else {
                    this.complete(task.id);
                }
            } catch (err) {
                logger.error(`AgentScheduler: Failed to execute task ${task.id}: ${err.message}`);
                // Leave task in queue — it will retry on next tick
            }
        }
    }

    size() {
        return this._tasks.length;
    }
}

module.exports = new AgentScheduler();
