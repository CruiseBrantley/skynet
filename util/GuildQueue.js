const { createAudioPlayer, AudioPlayerStatus, joinVoiceChannel } = require('@discordjs/voice');
const playVideo = require('./playVideo');
const logger = require('../logger');

class GuildQueue {
    constructor(guildId, adapterCreator) {
        this.guildId = guildId;
        this.adapterCreator = adapterCreator;
        this.queue = [];
        this.player = createAudioPlayer();
        this.connection = null;
        this.currentSubscription = null;

        this.player.on(AudioPlayerStatus.Idle, () => {
            logger.info(`Player idle in guild ${this.guildId}, playing next...`);
            this.playNext();
        });

        this.player.on('error', (error) => {
            logger.error(`GuildQueue Player Error [${this.guildId}]: ${error.message}`);
            this.playNext();
        });
    }

    async join(channelId) {
        if (this.connection && this.connection.joinConfig.channelId === channelId) {
            return; // Already joined
        }

        this.connection = joinVoiceChannel({
            channelId: channelId,
            guildId: this.guildId,
            adapterCreator: this.adapterCreator,
        });
        
        this.currentSubscription = this.connection.subscribe(this.player);
        logger.info(`Joined channel ${channelId} in guild ${this.guildId}`);
    }

    add(video) {
        this.queue.push(video);
        if (this.player.state.status === AudioPlayerStatus.Idle && this.queue.length === 1) {
            this.playNext();
        }
    }

    addBatch(videos) {
        this.queue.push(...videos);
        if (this.player.state.status === AudioPlayerStatus.Idle) {
            this.playNext();
        }
    }

    async playNext() {
        if (this.queue.length === 0) {
            logger.info(`Queue empty for guild ${this.guildId}`);
            return;
        }

        const nextVideo = this.queue.shift();
        try {
            const resource = await playVideo(nextVideo.url);
            this.player.play(resource);
            logger.info(`Now playing in ${this.guildId}: ${nextVideo.title || nextVideo.url}`);
        } catch (err) {
            logger.error(`Failed to play next video in ${this.guildId}: ${err.message}`);
            // If failed, try the next one after a short delay to avoid tight loop
            setTimeout(() => this.playNext(), 1000);
        }
    }

    skip() {
        if (this.queue.length === 0 && this.player.state.status === AudioPlayerStatus.Playing) {
            this.player.stop(); // Just stop if nothing next
            return;
        }
        this.player.stop(); // Triggers Idle event which calls playNext
    }

    stop() {
        this.queue = [];
        this.player.stop(true);
        if (this.connection) {
            this.connection.destroy();
            this.connection = null;
        }
    }
}

module.exports = GuildQueue;
