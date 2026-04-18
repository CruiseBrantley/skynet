const { ComponentType, MessageFlags } = require('discord.js');
const GuildQueue = require('./GuildQueue');
const logger = require('../logger');
const musicUI = require('./MusicUI');

/**
 * Singleton that manages per-guild music queues.
 * All state is keyed by guildId — no cross-server leakage.
 */
class MusicManager {
    constructor() {
        /** @type {Map<string, GuildQueue>} */
        this.queues = new Map();
        /** @type {Map<string, { stageMessage: any, textChannel: any, interval: NodeJS.Timeout, deleteTimer: NodeJS.Timeout|null }>} */
        this.uiStates = new Map();
    }

    /**
     * Get or create the queue for a guild. Each guild is fully isolated.
     */
    getOrCreateQueue(guildId, adapterCreator) {
        if (!this.queues.has(guildId)) {
            logger.info(`Creating new music queue for guild ${guildId}`);
            const queue = new GuildQueue(guildId, adapterCreator);

            // Hook into queue events for automatic UI management
            queue.onTrackStart = (track) => {
                this._handleTrackStart(guildId, track);
            };
            queue.onQueueEnd = () => this._scheduleIdleDelete(guildId);
            queue.onAutoplayTrigger = (lastTrack, history) => this.triggerAutoplay(guildId, lastTrack, history);
            this.queues.set(guildId, queue);
        }
        return this.queues.get(guildId);
    }

    /**
     * Get the queue for a guild, or null if none exists.
     */
    getQueue(guildId) {
        return this.queues.get(guildId) || null;
    }

    /**
     * Add a track to the guild's queue and start playback if idle.
     * Does NOT clear the queue — use this for all play operations.
     * @param {object} interaction - Discord interaction (needs guildId and member voice state)
     * @param {object} track - { url, title, channel?, duration?, thumbnail? }
     * @returns {GuildQueue} The guild queue instance
     */
    async enqueue(interaction, track, user = null) {
        const guildId = interaction.guildId;
        const channelId = interaction.member?.voice?.channelId;

        if (!channelId) {
            throw new Error('You need to be in a voice channel to play music.');
        }

        const queue = this.getOrCreateQueue(guildId, interaction.guild.voiceAdapterCreator);
        const channel = interaction.guild.channels.cache.get(channelId);
        await queue.join(channel);
        
        // Add to queue with requester info
        const requester = user || interaction.user || 'Unknown';
        queue.add(track, requester);

        return queue;
    }

    /**
     * Add a batch of tracks to the guild's queue.
     * @param {object} interaction
     * @param {object[]} tracks - Array of { url, title, channel?, duration?, thumbnail? }
     * @returns {GuildQueue}
     */
    async enqueueBatch(interaction, tracks, user = null) {
        const guildId = interaction.guildId;
        const channelId = interaction.member?.voice?.channelId;

        if (!channelId) {
            throw new Error('You need to be in a voice channel to play music.');
        }

        const queue = this.getOrCreateQueue(guildId, interaction.guild.voiceAdapterCreator);
        const channel = interaction.guild.channels.cache.get(channelId);
        await queue.join(channel);
        
        // Add to queue with requester info
        const requester = user || interaction.user || 'Unknown';
        queue.addBatch(tracks, requester);

        return queue;
    }

    /**
     * Skip the current track in the guild.
     */
    skip(guildId) {
        const queue = this.queues.get(guildId);
        if (queue) queue.skip();
    }

    /**
     * Pause playback in the guild.
     */
    pause(guildId) {
        const queue = this.queues.get(guildId);
        return queue ? queue.pause() : false;
    }

    /**
     * Resume playback in the guild.
     */
    resume(guildId) {
        const queue = this.queues.get(guildId);
        return queue ? queue.resume() : false;
    }

    /**
     * Get the currently playing track for a guild.
     */
    nowPlaying(guildId) {
        const queue = this.queues.get(guildId);
        return queue?.currentTrack || null;
    }

    /**
     * Get the upcoming tracks for a guild (excludes current).
     */
    getUpcoming(guildId) {
        const queue = this.queues.get(guildId);
        return queue ? [...queue.queue] : [];
    }

    /**
     * Seek to a position (in seconds) in the current track.
     * @returns {Promise<boolean>}
     */
    async seek(guildId, seconds) {
        const queue = this.queues.get(guildId);
        return queue ? queue.seek(seconds) : false;
    }

    /**
     * Get the current playback position in seconds.
     */
    getPositionSeconds(guildId) {
        const queue = this.queues.get(guildId);
        return queue ? queue.getPositionSeconds() : 0;
    }

    /**
     * Centralized button interaction handler for all music controls.
     */
    async handleInteraction(btn) {
        const guildId = btn.guildId;
        const queue = this.getQueue(guildId);
        if (!queue) return;

        try {
            if (btn.customId === 'music_pause') {
                if (queue.isPaused()) {
                    this.resume(guildId);
                } else if (queue.isPlaying()) {
                    this.pause(guildId);
                }
                await btn.deferUpdate().catch(() => {});
            }

            else if (btn.customId === 'music_skip') {
                this.skip(guildId);
                await btn.deferUpdate().catch(() => {});
            }

            else if (btn.customId === 'music_skip_next') {
                const skipped = queue.skipNext();
                if (skipped) {
                    await btn.deferUpdate().catch(() => {});
                } else {
                    await btn.reply({
                        content: `⚠️ No upcoming track to remove.`,
                        flags: [MessageFlags.SuppressEmbeds, MessageFlags.Ephemeral],
                    });
                    setTimeout(() => btn.deleteReply().catch(() => {}), 5000);
                }
            }

            else if (btn.customId === 'music_stop') {
                this.stop(guildId);
                btn.client.user.setActivity(process.env.ACTIVITY || '');
                await btn.deferUpdate().catch(() => {});
            }

            else if (btn.customId === 'music_restart') {
                await queue.restart();
                // If the queue had ended and the idle-delete timer is running,
                // cancel it and bring the live ticker back — the song is playing again.
                this._cancelIdleDelete(guildId);
                await btn.deferUpdate().catch(() => {});
            }

            else if (btn.customId === 'music_autoplay') {
                queue.autoplay = !queue.autoplay;
                await btn.deferUpdate().catch(() => {});
            }

            else if (btn.customId === 'music_lyrics') {
                const state = this.uiStates.get(guildId);
                if (state) {
                    if (state.showLyrics) {
                        state.showLyrics = false;
                    } else {
                        state.showLyrics = true;
                        // Fetch if not already present
                        if (!state.lyrics && queue.currentTrack) {
                            const lyricsService = require('./LyricsService');
                            state.lyrics = await lyricsService.fetchLyrics(
                                queue.currentTrack.title, 
                                queue.currentTrack.channel
                            );
                            if (!state.lyrics) state.lyrics = '⚠️ No lyrics found for this track.';
                        }
                    }
                }
                await btn.deferUpdate().catch(() => {});
            }

            else if (btn.customId === 'music_shuffle') {
                if (queue.queue.length > 1) {
                    queue.shuffle();
                    await btn.deferUpdate().catch(() => {});
                } else {
                    await btn.reply({
                        content: `⚠️ Not enough tracks in the queue to shuffle.`,
                        flags: [MessageFlags.SuppressEmbeds, MessageFlags.Ephemeral],
                    });
                    setTimeout(() => btn.deleteReply().catch(() => {}), 5000);
                }
            }

            // Manually trigger a UI update for instant feedback (AIO Abstraction)
            const state = this.uiStates.get(guildId);
            if (state && state.stageMessage) {
                const track = queue.currentTrack;
                if (track) {
                    const displayState = musicUI.buildFullDisplayState(
                        track, 
                        [...queue.queue], 
                        queue.getPositionSeconds(), 
                        queue.isPaused(), 
                        queue.autoplay, 
                        { volume: queue.volume, bitrate: queue.bitrate },
                        state.showLyrics ? state.lyrics : null
                    );
                    await state.stageMessage.edit(displayState).catch(() => {});
                }
            }
        } catch (err) {
            logger.error(`Interaction handler failed in ${guildId}: ${err.message}`);
        }
    }

    /**
     * Internal: Attach a collector to a music message.
     */
    _attachControlCollector(message, guildId) {
        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 1200_000, // 20 minutes
        });

        collector.on('collect', (btn) => this.handleInteraction(btn));
        
        collector.on('end', (_, reason) => {
            if (reason === 'time' || reason === 'stopped') {
                this.stopUIUpdate(guildId);
            }
        });
    }

    /**
     * Start a periodic UI update loop for the dual-message dashboard.
     */
    startUIUpdate(guildId, stageMessage, textChannel) {
        this.stopUIUpdate(guildId, false);

        const state = {
            stageMessage,
            textChannel,
            interval: null,
            deleteTimer: null,
            lyrics: null,
            showLyrics: false
        };

        const queue = this.getQueue(guildId);
        const dispatchedThumb = musicUI.normalizeThumbnail(queue?.currentTrack?.thumbnail);
        logger.info(`Starting UI ticker for guild ${guildId}. Dispatched Thumbnail: ${dispatchedThumb || 'None'}`);

        // Attach global button listener to ONE message
        this._attachControlCollector(stageMessage, guildId);

        state.interval = setInterval(async () => {
            const queue = this.getQueue(guildId);
            if (!queue) {
                this.stopUIUpdate(guildId);
                return;
            }
            if (!queue.currentTrack) return;

            // Instant Autoplay preload logic...
            if (queue.autoplay && queue.queue.length === 0 && !queue.isAutoplayFetching) {
                queue.isAutoplayFetching = true;
                if (queue.onAutoplayTrigger) {
                    queue.onAutoplayTrigger(queue.currentTrack, queue.history).finally(() => {
                        queue.isAutoplayFetching = false;
                    });
                }
            }

            try {
                const track = queue.currentTrack;
                const pos = queue.getPositionSeconds();
                const upcoming = [...queue.queue];
                const stats = { volume: queue.volume, bitrate: queue.bitrate };

                const displayState = musicUI.buildFullDisplayState(
                    track, 
                    upcoming, 
                    pos, 
                    queue.isPaused(), 
                    queue.autoplay, 
                    stats,
                    state.showLyrics ? state.lyrics : null
                );
                await stageMessage.edit(displayState);
            } catch (err) {
                if (err.code === 10008) { // Unknown Message
                    logger.warn(`UI message deleted in ${guildId}, regenerating...`);
                    const channel = state.textChannel;
                    this.stopUIUpdate(guildId, false);
                    if (queue.currentTrack && channel) {
                        this._handleTrackStart(guildId, queue.currentTrack, channel);
                    }
                } else {
                    logger.warn(`UI update failed for guild ${guildId}: ${err.message}`);
                    this.stopUIUpdate(guildId, false);
                }
            }
        }, 5000);

        this.uiStates.set(guildId, state);
    }

    /**
     * Internal: handles when a new track starts (automatic UI advancement).
     */
    async _handleTrackStart(guildId, track, forcedChannel = null) {
        let textChannel = forcedChannel || this.uiStates.get(guildId)?.textChannel;
        
        // --- DEEP RESOLUTION FALLBACK ---
        if (typeof textChannel?.send !== 'function') {
            const queue = this.getQueue(guildId);
            if (queue?.client && textChannel?.id) {
                logger.debug(`Heuristic: Re-fetching channel ${textChannel.id} for guild ${guildId}`);
                textChannel = queue.client.channels.cache.get(textChannel.id) || await queue.client.channels.fetch(textChannel.id).catch(() => null);
            }
        }
        
        if (!textChannel || typeof textChannel.send !== 'function') {
            logger.warn(`Failed to advance UI for guild ${guildId}: No valid text channel found.`);
            return;
        }

        try {
            // 1. Delete the old message
            await this.stopUIUpdate(guildId, true);

            // 2. Prepare Display State via Abstraction
            const queue = this.getQueue(guildId);
            const displayState = musicUI.buildFullDisplayState(
                track, 
                [...queue.queue], 
                0, 
                queue.isPaused(), 
                queue.autoplay, 
                { volume: queue.volume, bitrate: queue.bitrate }
            );

            // 3. Send single AIO message with defensive check
            if (typeof textChannel?.send !== 'function') {
                logger.warn(`Failed to advance UI for guild ${guildId}: textChannel is not a sender. Re-fetching...`);
                return;
            }

            const stageMessage = await textChannel.send(displayState);

            // 4. Restart loop
            this.startUIUpdate(guildId, stageMessage, textChannel);
        } catch (err) {
            logger.error(`Failed to advance UI for guild ${guildId}: ${err.message}`);
        }
    }

    /**
     * Stop the UI update loop and optionally delete the message.
     */
    async stopUIUpdate(guildId, deleteMessage = true) {
        const state = this.uiStates.get(guildId);
        if (state) {
            if (state.interval) clearInterval(state.interval);
            // Always cancel any pending idle-delete timer when the state is torn down
            if (state.deleteTimer) clearTimeout(state.deleteTimer);
            if (deleteMessage) {
                try {
                    if (state.stageMessage) await state.stageMessage.delete().catch(() => {});
                    if (state.dashboardMessage) await state.dashboardMessage.delete().catch(() => {});
                } catch (err) {
                    // Ignore deletion errors
                }
            }
            this.uiStates.delete(guildId);
        }
    }

    /**
     * Called when the queue empties naturally (last track finishes).
     * Stops the live-update ticker but keeps the message visible for 5 minutes
     * so users can still see what was playing before it disappears.
     * Any call to stop() or a new track starting will cancel this timer early.
     */
    _scheduleIdleDelete(guildId) {
        const IDLE_DELETE_MS = 5 * 60 * 1000; // 5 minutes
        const state = this.uiStates.get(guildId);
        if (!state) return;

        // currentTrack is kept alive (see GuildQueue Idle handler), so the ticker
        // keeps running and the UI stays fully interactive. We just arm the cleanup.
        // Guard against a double-timer if Restart is hit and the song finishes again.
        if (state.deleteTimer) clearTimeout(state.deleteTimer);

        logger.info(`Queue ended for guild ${guildId}. Music message will be deleted in 5 minutes.`);
        state.deleteTimer = setTimeout(async () => {
            // Only act if this state is still the active one
            if (this.uiStates.get(guildId) === state) {
                logger.info(`Idle timer expired for guild ${guildId}. Cleaning up UI and disconnecting voice.`);
                this.stop(guildId);
            }
        }, IDLE_DELETE_MS);
    }

    /**
     * Cancel a pending idle-delete for a guild (e.g. when a song is restarted
     * after the queue emptied). The live ticker never stopped (currentTrack stays
     * alive), so all we need to do is disarm the timer.
     */
    _cancelIdleDelete(guildId) {
        const state = this.uiStates.get(guildId);
        if (!state || !state.deleteTimer) return; // Nothing pending, no-op

        clearTimeout(state.deleteTimer);
        state.deleteTimer = null;
        logger.info(`Idle-delete cancelled for guild ${guildId} (song restarted).`);
    }

    /**
     * Stop playback, clear the queue, and disconnect from voice.
     * Removes the queue from the manager entirely.
     */
    stop(guildId) {
        this.stopUIUpdate(guildId); // Cleanup UI first
        const queue = this.getQueue(guildId);
        if (queue) {
            queue.stop();
            this.queues.delete(guildId); // Clear from map
        }
    }

    /**
     * Internal: fetch a recommendation and play it (Autoplay loop).
     */
    async triggerAutoplay(guildId, lastTrack, sessionHistory) {
        const youtube = require('./YouTubeMetadata');
        const queue = this.getQueue(guildId);
        if (!queue) return;

        try {
            // Get last 5 tracks + current track for superior context
            const historyContext = queue.getRecentHistory();
            const recommendation = await youtube.getRecommendation(historyContext, sessionHistory);
            
            if (recommendation) {
                logger.info(`Autoplay: Found recommendation for ${guildId} -> ${recommendation.title}`);
                queue.add(recommendation, 'Skynet Autoplay');
            } else {
                logger.warn(`Autoplay: No recommendations found for guild ${guildId}`);
                this.stopUIUpdate(guildId);
            }
        } catch (err) {
            logger.error(`Autoplay failed for guild ${guildId}: ${err.message}`);
            this.stopUIUpdate(guildId);
        }
    }
}

// Singleton
module.exports = new MusicManager();
