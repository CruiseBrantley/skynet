const GuildQueue = require('./GuildQueue');
const logger = require('../logger');

class MusicManager {
    constructor() {
        this.queues = new Map();
    }

    getOrCreateQueue(guildId, adapterCreator) {
        if (!this.queues.has(guildId)) {
            logger.info(`Creating new Music Queue for guild ${guildId}`);
            this.queues.set(guildId, new GuildQueue(guildId, adapterCreator));
        }
        return this.queues.get(guildId);
    }

    async play(interaction, query) {
        const guildId = interaction.guildId;
        const channelId = interaction.member?.voice?.channelId;
        
        if (!channelId) {
            return interaction.reply({ content: "You need to be in a voice channel to play music!", ephemeral: true });
        }

        const queue = this.getOrCreateQueue(guildId, interaction.guild.voiceAdapterCreator);
        await queue.join(channelId);

        // Resolve query (handle green/blue/red aliases if needed here or in command)
        let videoUrl = query;
        if (query === 'green' && global.lastSearch?.length) videoUrl = global.lastSearch[0].link;
        else if (query === 'blue' && global.lastSearch?.length) videoUrl = global.lastSearch[1].link;
        else if (query === 'red' && global.lastSearch?.length) videoUrl = global.lastSearch[2].link;

        // If it's a direct play/interrupt, we clear the queue and add only this one
        queue.queue = [];
        queue.add({ url: videoUrl, title: videoUrl });
        
        return videoUrl;
    }

    async enqueue(interaction, query) {
        const guildId = interaction.guildId;
        const channelId = interaction.member?.voice?.channelId;
        
        if (!channelId) return;

        const queue = this.getOrCreateQueue(guildId, interaction.guild.voiceAdapterCreator);
        await queue.join(channelId);
        
        queue.add({ url: query, title: query });
        return query;
    }

    async addBatch(interaction, items) {
        const guildId = interaction.guildId;
        const channelId = interaction.member?.voice?.channelId;
        
        if (!channelId) return;

        const queue = this.getOrCreateQueue(guildId, interaction.guild.voiceAdapterCreator);
        await queue.join(channelId);
        
        queue.addBatch(items.map(item => ({ url: item.shortUrl || item.url, title: item.title })));
    }

    skip(guildId) {
        const queue = this.queues.get(guildId);
        if (queue) queue.skip();
    }

    stop(guildId) {
        const queue = this.queues.get(guildId);
        if (queue) {
            queue.stop();
            this.queues.delete(guildId);
        }
    }
}

// Singleton instance
module.exports = new MusicManager();
