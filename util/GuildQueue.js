const { createAudioPlayer, AudioPlayerStatus, joinVoiceChannel, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const playVideo = require('./playVideo');
const logger = require('../logger');
const fs = require('fs');
const path = require('path');
const youtube = require('./YouTubeMetadata');

/**
 * Per-guild audio queue. Manages voice connection, playback, and track list.
 * Each guild gets its own isolated instance — no shared state between servers.
 */
class GuildQueue {
    constructor(guildId, adapterCreator) {
        this.guildId = guildId;
        this.adapterCreator = adapterCreator;
        this.queue = [];
        this.currentTrack = null;
        this.player = createAudioPlayer();
        this.connection = null;
        this.currentSubscription = null;

        // Playback position tracking
        this._playbackStartedAt = null;  // Date.now() when playback started/resumed
        this._seekOffsetMs = 0;          // Accumulated offset from seeks
        this._pausedAt = null;           // Date.now() when paused
        this.bitrate = 64000;            // Default 64kbps, updated on join()
        this.volume = 1.0;               // Default 100% volume (internally 25%)
        this.autoplay = false;           // Continue playing similar songs
        this.lastPlayedTrack = null;     // Memory of last track for recommendations
        this.recentTracks = [];          // Rolling history of recent tracks for AI context
        this.history = new Set();        // Remember played video IDs to prevent autoplay loops
        this._isProcessingNext = false;  // Lock for _playNext race conditions

        /** Optional callback fired when a new track starts playing. */
        this.onTrackStart = null;

        /** Optional callback fired when the queue runs out and playback ends. */
        this.onQueueEnd = null;

        this.player.on(AudioPlayerStatus.Idle, () => {
            logger.info(`Player idle in guild ${this.guildId}, advancing queue...`);
            this._cleanupCurrentTrackFile();
            if (this.currentTrack) {
                this.lastPlayedTrack = this.currentTrack;
                this._addToRecentHistory(this.currentTrack);
            }
            this._resetPosition();
            // Only clear currentTrack if there's something next to play or autoplay
            // will fill the queue. When the queue is empty and autoplay is off, keep
            // currentTrack alive so the idle-window UI and Restart button still work.
            // MusicManager._scheduleIdleDelete will null it out after 5 minutes.
            if (this.queue.length > 0 || this.autoplay) {
                this.currentTrack = null;
            }
            this._playNext();
        });

        this.player.on(AudioPlayerStatus.Playing, () => {
            if (!this._playbackStartedAt) {
                this._playbackStartedAt = Date.now();
                logger.info(`Playback started in guild ${this.guildId}`);
            }
        });

        this.player.on('error', (error) => {
            logger.error(`GuildQueue Player Error [${this.guildId}]: ${error.message}`);
            if (this.currentTrack) {
                this.lastPlayedTrack = this.currentTrack;
                this._addToRecentHistory(this.currentTrack);
            }
            this.currentTrack = null;
            this._resetPosition();
            this._playNext();
        });
    }

    /**
     * Join a voice channel. Extracts bitrate for optimized playback.
     * @param {VoiceChannel} channel - The Discord VoiceChannel object
     */
    async join(channel) {
        if (!channel) return;
        const channelId = channel.id;

        if (this.connection && this.connection.joinConfig.channelId === channelId) {
            this.bitrate = channel.bitrate || 64000;
            return;
        }

        this.connection = joinVoiceChannel({
            channelId,
            guildId: this.guildId,
            adapterCreator: this.adapterCreator,
        });

        // Wait for connection to be ready before proceeding
        try {
            await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
            logger.info(`Voice connection ready in channel ${channel.name} (${channelId})`);
        } catch (err) {
            this.connection.destroy();
            this.connection = null;
            throw new Error(`Failed to join voice channel ${channel.name} within 20 seconds: ${err.message}`);
        }

        this.bitrate = channel.bitrate || 64000;
        this.currentSubscription = this.connection.subscribe(this.player);
        logger.info(`Joined voice channel ${channel.name} (${channelId}) in guild ${this.guildId} [Bitrate: ${this.bitrate}bps]`);
    }

    /**
     * Add a single track to the end of the queue.
     * If nothing is playing, starts playback immediately.
     * @param {object} track - { url, title, channel, duration, thumbnail }
     */
    add(track, user = null) {
        if (user) track.requestedBy = user.username || user;
        this.queue.push(track);
        if (this.player.state.status === AudioPlayerStatus.Idle && this.queue.length === 1) {
            this._playNext();
        } else {
            this._prefetchNext();
        }
    }

    /**
     * Add multiple tracks to the end of the queue.
     * If nothing is playing, starts playback immediately.
     * @param {object[]} tracks
     */
    addBatch(tracks, user = null) {
        if (user) {
            tracks.forEach(t => t.requestedBy = user.username || user);
        }
        this.queue.push(...tracks);
        if (this.player.state.status === AudioPlayerStatus.Idle) {
            this._playNext();
        } else {
            this._prefetchNext();
        }
    }

    skip() {
        if (this.currentTrack) {
            this.lastPlayedTrack = this.currentTrack;
            this._addToRecentHistory(this.currentTrack);
        }
        this.player.stop(true);
    }

    /**
     * Skip the next song in the queue (without playing it).
     * Adds it to history and recentTracks so the AI knows to avoid it.
     */
    skipNext() {
        if (this.queue.length === 0) return null;
        const skipped = this.queue.shift();
        
        // Contextually 'record' this track in our history as something the user skipped/didn't want now
        const videoId = playVideo.extractVideoId(skipped.url);
        if (videoId) this.history.add(videoId);
        this._addToRecentHistory(skipped);

        // Preload the NEW next song
        this._prefetchNext();
        return skipped;
    }

    /**
     * Randomize the upcoming tracks in the queue.
     * Starts prefetching the new first track after shuffling.
     */
    shuffle() {
        if (this.queue.length <= 1) return;
        
        // Fisher-Yates shuffle
        for (let i = this.queue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
        }
        
        // Kick off a fresh prefetch since the next song has changed
        this._prefetchNext();
    }

    /**
     * Pause playback.
     */
    pause() {
        const status = this.player.state.status;
        if (status === AudioPlayerStatus.Playing || status === AudioPlayerStatus.Buffering) {
            this._pausedAt = Date.now();
            this.player.pause();
            return true;
        }
        return false;
    }

    /**
     * Resume playback.
     */
    resume() {
        if (this.player.state.status === AudioPlayerStatus.Paused) {
            // Account for time spent paused so the timer doesn't jump forward permanently
            if (this._pausedAt && this._playbackStartedAt) {
                const pauseDuration = Date.now() - this._pausedAt;
                this._playbackStartedAt += pauseDuration;
            }
            this._pausedAt = null;
            this.player.unpause();
            return true;
        }
        return false;
    }

    /**
     * Whether the player is currently paused.
     */
    isPaused() {
        return this.player.state.status === AudioPlayerStatus.Paused;
    }

    /**
     * Internal: cleanup the local temp file for the current track.
     */
    _cleanupCurrentTrackFile() {
        if (!this.currentTrack) return;
        const videoId = playVideo.extractVideoId(this.currentTrack.url);
        if (!videoId) return;

        const filePath = path.join('/Users/cruise/git/skynet/temp_music', `${videoId}.opus`);
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                logger.info(`Cleaned up temp file: ${videoId}.opus`);
            } catch (err) {
                logger.warn(`Failed to cleanup temp file ${filePath}: ${err.message}`);
            }
        }
    }

    /**
     * Whether the player is currently playing (not idle, not paused).
     */
    isPlaying() {
        const status = this.player.state.status;
        return status === AudioPlayerStatus.Playing || status === AudioPlayerStatus.Buffering;
    }

    /**
     * Get the current playback position in seconds.
     */
    getPositionSeconds() {
        if (!this._playbackStartedAt) return 0;

        const now = this._pausedAt || Date.now();
        const elapsedMs = now - this._playbackStartedAt;
        const totalMs = this._seekOffsetMs + elapsedMs;

        return Math.max(0, Math.floor(totalMs / 1000));
    }

    /**
     * Seek to an absolute position (in seconds) within the current track.
     * Re-creates the audio resource from the new position.
     * @param {number} seconds - The target position in seconds.
     * @returns {Promise<boolean>} Whether the seek succeeded.
     */
    async seek(seconds) {
        if (!this.currentTrack) return false;
        const targetSeconds = Math.max(0, seconds);

        try {
            logger.info(`Seeking to ${targetSeconds}s in guild ${this.guildId}`);
            const youtube = require('./YouTubeMetadata');
            const videoId = youtube.extractVideoId(this.currentTrack.url);
            const cached = videoId ? youtube.cache.get(videoId) : null;

            const resource = await playVideo(this.currentTrack.url, { 
                seekSeconds: targetSeconds,
                bitrate: this.bitrate,
                loudnorm: cached?.loudnorm || null
            });

            // Reset position tracking to the seek target
            this._seekOffsetMs = targetSeconds * 1000;
            this._playbackStartedAt = Date.now();
            this._pausedAt = null;
            if (resource.volume) {
                resource.volume.setVolume(this.volume * 0.25);
            }
            this.player.play(resource);
            return true;
        } catch (err) {
            logger.error(`Seek failed in ${this.guildId}: ${err.message}`);
            return false;
        }
    }

    /**
     * Restart the current track from 0:00.
     * @returns {Promise<boolean>}
     */
    async restart() {
        return this.seek(0);
    }

    /**
     * Stop playback, clear the queue, and disconnect from voice.
     */
    stop() {
        this._cleanupCurrentTrackFile();
        this.queue = [];
        this.currentTrack = null;
        this._resetPosition();
        this.player.stop(true);
        if (this.connection) {
            this.connection.destroy();
            this.connection = null;
        }
    }

    /**
     * Internal: Prefetch the next track in the queue to ensure zero-gap playback.
     */
    async _prefetchNext() {
        if (this.queue.length === 0) return;
        const next = this.queue[0];
        try {
            logger.info(`Prefetching next track: ${next.title || next.url}`);
            const filePath = await playVideo.downloadVideo(next.url);
            
            // Analyze loudness in the background
            const { analyzeLoudness } = require('./playVideo');
            const youtube = require('./YouTubeMetadata');
            const videoId = youtube.extractVideoId(next.url);
            const stats = await analyzeLoudness(filePath);
            if (stats && videoId) {
                logger.info(`Dual-Pass: Captured loudness stats for ${videoId}`);
                youtube.setLoudnormStats(videoId, stats);
            }
        } catch (err) {
            logger.warn(`Prefetch failed for ${next.url}: ${err.message}`);
        }
    }

    /**
     * Add a track to the rolling recent history for context.
     * @param {object} track - Track object { title, channel, ... }
     */
    _addToRecentHistory(track) {
        if (!track || !track.title) return;
        // Optimization: only store what we need for the LLM
        const summary = {
            title: track.title,
            channel: track.channel || 'Unknown'
        };
        this.recentTracks.push(summary);
        if (this.recentTracks.length > 5) {
            this.recentTracks.shift();
        }
    }

    /**
     * Get the current context for recommendations: [Past Songs..., Now Playing]
     * @returns {object[]} Array of track summaries
     */
    getRecentHistory() {
        const history = [...this.recentTracks];
        if (this.currentTrack) {
            history.push({
                title: this.currentTrack.title,
                channel: this.currentTrack.channel || 'Unknown'
            });
        }
        return history;
    }

    /**
     * Internal: reset position tracking state.
     */
    _resetPosition() {
        this._playbackStartedAt = null;
        this._seekOffsetMs = 0;
        this._pausedAt = null;
    }

    /**
     * Internal: play the next track in the queue, or signal that the queue is done.
     */
    async _playNext() {
        if (this._isProcessingNext) return;
        this._isProcessingNext = true;

        if (this.queue.length === 0) {
            logger.info(`Queue empty for guild ${this.guildId}`);
            if (this.autoplay && this.lastPlayedTrack) {
                if (this.isAutoplayFetching) {
                    logger.info(`Autoplay is already fetching for ${this.guildId}, waiting...`);
                } else {
                    logger.info(`Autoplay enabled for ${this.guildId}. Triggering recommendation...`);
                    this.isAutoplayFetching = true;
                    if (this.onAutoplayTrigger) {
                        this.onAutoplayTrigger(this.lastPlayedTrack, this.history).finally(() => {
                            this.isAutoplayFetching = false;
                        });
                    }
                }
            } else if (this.onQueueEnd) {
                this.onQueueEnd();
            }
            this._isProcessingNext = false;
            return;
        }

        const youtube = require('./YouTubeMetadata');
        const track = this.queue.shift();
        this.lastPlayedTrack = this.currentTrack;
        
        // Enrich track metadata from cache (e.g. duration, thumbnail, loudnorm)
        const videoId = youtube.extractVideoId(track.url);
        if (videoId) this.history.add(videoId);

        let cached = null;
        try {
            cached = await youtube.getVideoInfo(track.url);
            if (cached.title === track.url) {
                // If API failed and returned empty url placeholder, don't overwrite our good track data
                this.currentTrack = { ...track, loudnorm: cached.loudnorm };
            } else {
                this.currentTrack = { ...track, ...cached };
            }
        } catch (err) {
            this.currentTrack = track; // Fallback to original
        }

        try {
            const resource = await playVideo(this.currentTrack.url, { 
                bitrate: this.bitrate,
                loudnorm: cached?.loudnorm || null
            });
            if (resource.volume) {
                resource.volume.setVolume(this.volume * 0.25);
            }
            this.player.play(resource);
            logger.info(`Now playing in ${this.guildId}: ${track.title || track.url}`);

            // Refresh currentTrack from cache because playVideo native-extracted rich metadata (like duration)!
            if (videoId) {
                const updatedCached = youtube.cache.get(videoId);
                if (updatedCached) {
                    this.currentTrack = { ...this.currentTrack, ...updatedCached };
                    if (this.currentTrack.durationSeconds) {
                        logger.info(`Enriched ${track.title} with duration: ${this.currentTrack.durationSeconds}s`);
                    }
                }
            }

            if (this.onTrackStart) this.onTrackStart(this.currentTrack);

            // Prefetch the next one immediately
            this._prefetchNext();
            this._isProcessingNext = false;
        } catch (err) {
            logger.error(`Failed to play in ${this.guildId}: ${err.message}`);
            this.currentTrack = null;
            this._resetPosition();
            this._isProcessingNext = false;
            // Avoid tight retry loop
            setTimeout(() => this._playNext(), 1000);
        }
    }
}

module.exports = GuildQueue;
