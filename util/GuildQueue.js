const { createAudioPlayer, AudioPlayerStatus, joinVoiceChannel } = require('@discordjs/voice');
const playVideo = require('./playVideo');
const logger = require('../logger');
const fs = require('fs');
const path = require('path');

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
        this.volume = 0.5;               // Default 50% volume

        /** Optional callback fired when a new track starts playing. */
        this.onTrackStart = null;

        /** Optional callback fired when the queue runs out and playback ends. */
        this.onQueueEnd = null;

        this.player.on(AudioPlayerStatus.Idle, () => {
            logger.info(`Player idle in guild ${this.guildId}, advancing queue...`);
            this._cleanupCurrentTrackFile();
            this.currentTrack = null;
            this._resetPosition();
            this._playNext();
        });

        this.player.on('error', (error) => {
            logger.error(`GuildQueue Player Error [${this.guildId}]: ${error.message}`);
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

        this.bitrate = channel.bitrate || 64000;
        this.currentSubscription = this.connection.subscribe(this.player);
        logger.info(`Joined voice channel ${channel.name} (${channelId}) in guild ${this.guildId} [Bitrate: ${this.bitrate}bps]`);
    }

    /**
     * Add a single track to the end of the queue.
     * If nothing is playing, starts playback immediately.
     * @param {object} track - { url, title, channel, duration, thumbnail }
     */
    add(track) {
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
    addBatch(tracks) {
        this.queue.push(...tracks);
        if (this.player.state.status === AudioPlayerStatus.Idle) {
            this._playNext();
        } else {
            this._prefetchNext();
        }
    }

    /**
     * Skip the current track. Triggers the Idle handler which calls _playNext.
     */
    skip() {
        this.player.stop();
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
            // Account for time spent paused
            if (this._pausedAt && this._playbackStartedAt) {
                // Don't adjust offset — we adjust getPosition to subtract pause time
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
            const resource = await playVideo(this.currentTrack.url, { 
                seekSeconds: targetSeconds,
                bitrate: this.bitrate,
            });

            // Reset position tracking to the seek target
            this._seekOffsetMs = targetSeconds * 1000;
            this._playbackStartedAt = Date.now();
            this._pausedAt = null;
            if (resource.volume) {
                resource.volume.setVolume(this.volume);
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
            await playVideo.downloadVideo(next.url);
        } catch (err) {
            logger.warn(`Prefetch failed for ${next.url}: ${err.message}`);
        }
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
        if (this.queue.length === 0) {
            logger.info(`Queue empty for guild ${this.guildId}`);
            if (this.onQueueEnd) this.onQueueEnd();
            return;
        }

        const youtube = require('./YouTubeMetadata');
        const track = this.queue.shift();
        
        try {
            // Enrich track metadata from cache (e.g. duration, thumbnail)
            this.currentTrack = await youtube.getVideoInfo(track.url);
        } catch (err) {
            this.currentTrack = track; // Fallback to original
        }

        try {
            const resource = await playVideo(this.currentTrack.url, { bitrate: this.bitrate });
            this._playbackStartedAt = Date.now();
            this._seekOffsetMs = 0;
            this._pausedAt = null;
            if (resource.volume) {
                resource.volume.setVolume(this.volume);
            }
            this.player.play(resource);
            logger.info(`Now playing in ${this.guildId}: ${track.title || track.url}`);
            if (this.onTrackStart) this.onTrackStart(track);

            // Prefetch the next one immediately
            this._prefetchNext();
        } catch (err) {
            logger.error(`Failed to play in ${this.guildId}: ${err.message}`);
            this.currentTrack = null;
            this._resetPosition();
            // Avoid tight retry loop
            setTimeout(() => this._playNext(), 1000);
        }
    }
}

module.exports = GuildQueue;
