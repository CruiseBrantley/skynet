const os = require('os');
const logger = require('../logger');

/**
 * InstanceGuardian - Prevents and detects multiple instances of the bot.
 * Uses Firebase heartbeats to track active sessions.
 */
class InstanceGuardian {
    constructor(database) {
        this.db = database;
        this.hostname = os.hostname();
        this.pid = process.pid;
        this.instanceId = `${this.hostname}_${this.pid}`;
        this.heartbeatInterval = null;
        this.instancesRef = this.db.ref('instances');
        this.HEARTBEAT_MS = 60000; // 1 minute
        this.FRESHNESS_THRESHOLD_MS = 150000; // 2.5 minutes (allows for some network lag)
    }

    /**
     * Start the guardian.
     */
    async init() {
        logger.info(`Guardian initializing for instance: ${this.instanceId}`);
        
        // 1. Check for conflicting instances
        const isDuplicate = await this.checkConflict();
        if (isDuplicate) {
            logger.warn('⚠️ CRITICAL: Another active instance of Skynet was detected!');
            logger.warn('This may result in duplicate responses. Please ensure only one instance is running.');
            // We could optionally process.exit() here, but warning is safer for now.
        }

        // 2. Start heartbeat
        this.updateHeartbeat();
        this.heartbeatInterval = setInterval(() => this.updateHeartbeat(), this.HEARTBEAT_MS);

        // 3. Cleanup on exit
        process.on('SIGINT', () => this.cleanup());
        process.on('SIGTERM', () => this.cleanup());
    }

    /**
     * Checks if there's another instance with a recent heartbeat.
     */
    async checkConflict() {
        try {
            const snapshot = await this.instancesRef.once('value');
            if (!snapshot.exists()) return false;

            const now = Date.now();
            const instances = snapshot.val();
            let conflictFound = false;

            for (const id in instances) {
                if (id === this.instanceId) continue;

                const lastHeartbeat = instances[id].heartbeat;
                if (now - lastHeartbeat < this.FRESHNESS_THRESHOLD_MS) {
                    logger.info(`Conflict detected with instance: ${id} (Last heartbeat: ${Math.round((now - lastHeartbeat) / 1000)}s ago)`);
                    conflictFound = true;
                }
            }

            return conflictFound;
        } catch (err) {
            logger.error(`Guardian failed to check conflicts: ${err.message}`);
            return false;
        }
    }

    /**
     * Updates the heartbeat for this instance in Firebase.
     */
    async updateHeartbeat() {
        try {
            await this.instancesRef.child(this.instanceId).set({
                heartbeat: Date.now(),
                hostname: this.hostname,
                pid: this.pid,
                startTime: this.startTime || Date.now()
            });
            if (!this.startTime) this.startTime = Date.now();
        } catch (err) {
            logger.error(`Guardian failed to update heartbeat: ${err.message}`);
        }
    }

    /**
     * Removes the instance record from Firebase on shutdown.
     */
    async cleanup() {
        logger.info('Guardian shutting down, cleaning up instance record...');
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        try {
            await this.instancesRef.child(this.instanceId).remove();
            process.exit(0);
        } catch (err) {
            logger.error(`Guardian failed to cleanup: ${err.message}`);
            process.exit(1);
        }
    }
}

module.exports = InstanceGuardian;
