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
        /** @type {Map<string, { message: any, interval: NodeJS.Timeout }>} */
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
            queue.onQueueEnd = () => this.stopUIUpdate(guildId);
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
    async enqueue(interaction, track) {
        const guildId = interaction.guildId;
        const channelId = interaction.member?.voice?.channelId;

        if (!channelId) {
            throw new Error('You need to be in a voice channel to play music.');
        }

        const queue = this.getOrCreateQueue(guildId, interaction.guild.voiceAdapterCreator);
        const channel = interaction.guild.channels.cache.get(channelId);
        await queue.join(channel);
        queue.add(track);

        return queue;
    }

    /**
     * Add a batch of tracks to the guild's queue.
     * @param {object} interaction
     * @param {object[]} tracks - Array of { url, title, channel?, duration?, thumbnail? }
     * @returns {GuildQueue}
     */
    async enqueueBatch(interaction, tracks) {
        const guildId = interaction.guildId;
        const channelId = interaction.member?.voice?.channelId;

        if (!channelId) {
            throw new Error('You need to be in a voice channel to play music.');
        }

        const queue = this.getOrCreateQueue(guildId, interaction.guild.voiceAdapterCreator);
        const channel = interaction.guild.channels.cache.get(channelId);
        await queue.join(channel);
        queue.addBatch(tracks);

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
                const skipped = queue.currentTrack;
                this.skip(guildId);
                await btn.reply({
                    content: `⏭ Skipped **${skipped?.title || 'current track'}**.`,
                    flags: [MessageFlags.SuppressEmbeds, MessageFlags.Ephemeral],
                });
                setTimeout(() => btn.deleteReply().catch(() => {}), 5000);
            }

            else if (btn.customId === 'music_stop') {
                this.stop(guildId);
                btn.client.user.setActivity(process.env.ACTIVITY || '');
                await btn.deferUpdate().catch(() => {});
            }

            else if (btn.customId === 'music_restart') {
                await queue.restart();
                await btn.deferUpdate().catch(() => {});
            }

            else if (btn.customId === 'music_autoplay') {
                queue.autoplay = !queue.autoplay;
                await btn.deferUpdate().catch(() => {});
            }

            else if (btn.customId === 'music_shuffle') {
                if (queue.queue.length > 1) {
                    queue.shuffle();
                    await btn.reply({
                        content: `🔀 Shuffled **${queue.queue.length}** upcoming tracks.`,
                        flags: [MessageFlags.SuppressEmbeds, MessageFlags.Ephemeral],
                    });
                } else {
                    await btn.reply({
                        content: `⚠️ Not enough tracks in the queue to shuffle.`,
                        flags: [MessageFlags.SuppressEmbeds, MessageFlags.Ephemeral],
                    });
                }
                setTimeout(() => btn.deleteReply().catch(() => {}), 5000);
            }

            // Manually trigger a UI update for instant feedback
            const state = this.uiStates.get(guildId);
            if (state && state.message) {
                const track = queue.currentTrack;
                if (track) {
                    const pos = queue.getPositionSeconds();
                    const embed = musicUI.buildNowPlayingEmbed(track, [...queue.queue], pos);
                    const rows = musicUI.buildControlRow(queue.isPaused(), queue.autoplay);
                    if (queue.isPaused()) {
                        embed.setColor(0xFEE75C).setAuthor({ name: '⏸ Paused' });
                    }
                    await state.message.edit({ embeds: [embed], components: rows }).catch(() => {});
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
     * Start a periodic UI update loop for the now playing embed.
     */
    startUIUpdate(guildId, message, textChannel) {
        this.stopUIUpdate(guildId, false);

        const state = {
            message,
            textChannel,
            interval: null,
        };

        // Attach global button listener
        this._attachControlCollector(message, guildId);

        state.interval = setInterval(async () => {
            const queue = this.getQueue(guildId);
            if (!queue) {
                this.stopUIUpdate(guildId);
                return;
            }
            if (!queue.currentTrack) {
                // If it's empty but queue hasn't ended yet (e.g. autoplay is fetching),
                // just wait. The actual end is handled definitively by queue.onQueueEnd
                return;
            }

            try {
                const track = queue.currentTrack;
                const pos = queue.getPositionSeconds();
                const upcoming = [...queue.queue];
                const embed = musicUI.buildNowPlayingEmbed(track, upcoming, pos);
                const rows = musicUI.buildControlRow(queue.isPaused(), queue.autoplay);

                if (queue.isPaused()) {
                    embed.setColor(0xFEE75C).setAuthor({ name: '⏸ Paused' });
                }

                await message.edit({ embeds: [embed], components: rows });
            } catch (err) {
                logger.warn(`UI update failed for guild ${guildId}: ${err.message}`);
                this.stopUIUpdate(guildId, false);
            }
        }, 5000);

        this.uiStates.set(guildId, state);
    }

    /**
     * Internal: handles when a new track starts (automatic UI advancement).
     */
    async _handleTrackStart(guildId, track) {
        const state = this.uiStates.get(guildId);
        if (!state || !state.textChannel) return;

        try {
            // 1. Delete the old message
            await this.stopUIUpdate(guildId, true);

            // 2. Send new message
            const queue = this.getQueue(guildId);
            const embed = musicUI.buildNowPlayingEmbed(track, [...queue.queue], 0);
            const rows = musicUI.buildControlRow(false, queue.autoplay);
            const newMessage = await state.textChannel.send({ embeds: [embed], components: rows });

            // 3. Restart loop
            this.startUIUpdate(guildId, newMessage, state.textChannel);
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
            clearInterval(state.interval);
            if (deleteMessage && state.message) {
                try {
                    await state.message.delete();
                } catch (err) {
                    // Ignore deletion errors
                }
            }
            this.uiStates.delete(guildId);
        }
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
    async triggerAutoplay(guildId, lastTrack, history) {
        const youtube = require('./YouTubeMetadata');
        const queue = this.getQueue(guildId);
        if (!queue) return;

        try {
            const recommendation = await youtube.getRecommendation(lastTrack, history);
            if (recommendation) {
                logger.info(`Autoplay: Found recommendation for ${guildId} -> ${recommendation.title}`);
                queue.add(recommendation);
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
