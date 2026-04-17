const {
    SlashCommandBuilder,
    ComponentType,
    ActionRowBuilder,
    ButtonBuilder
} = require('discord.js');
const decode = require('unescape');
const logger = require('../logger');
const musicManager = require('../util/MusicManager');
const musicUI = require('../util/MusicUI');
const youtube = require('../util/YouTubeMetadata');

// ── Subcommand handlers ──

async function handlePlay(interaction) {
    const query = interaction.options.getString('query');
    const channel = interaction.options.getChannel('channel')
        || interaction.guild.channels.cache.get(interaction.member?.voice?.channelId);

    if (!channel) {
        return interaction.reply({
            content: 'You need to be in a voice channel or specify one.',
            flags: [64],
        });
    }

    const isActive = musicManager.uiStates.has(interaction.guildId);
    await interaction.deferReply({ flags: isActive ? [64] : [] });

    try {
        let tracks = [];
        let playlistTitle = null;

        if (youtube.isYouTubeURL(query) && youtube.isPlaylistURL(query)) {
            // Playlist URL
            const playlist = await youtube.expandPlaylist(query);
            tracks = playlist.tracks;
            playlistTitle = playlist.title;
        } else if (youtube.isYouTubeURL(query)) {
            // Direct Video URL
            const track = await youtube.getVideoInfo(query);
            tracks = [track];
        } else {
            // Search term
            const results = await youtube.search(query, 1);
            if (!results.length) {
                return interaction.editReply(`No results found for **${query}**.`);
            }
            tracks = [results[0]];
        }

        const fakeInteraction = {
            guildId: interaction.guildId,
            guild: interaction.guild,
            member: { voice: { channelId: channel.id } },
        };

        if (tracks.length > 1) {
            await musicManager.enqueueBatch(fakeInteraction, tracks, interaction.user);
            interaction.client.user.setActivity('YouTube.');

            const isActive = musicManager.uiStates.has(interaction.guildId);

            // If this is a new session, start the AIO UI with the first track
            if (!isActive && tracks.length > 0) {
                // Enrich the first track metadata before showing the UI
                const firstTrack = await youtube.getVideoInfo(tracks[0].url);
                const upcoming = musicManager.getUpcoming(interaction.guildId);
                const displayState = musicUI.buildFullDisplayState(
                    firstTrack, upcoming, 0, false, false, { volume: 0.5, bitrate: 64000 }, null
                );

                const msg = await interaction.editReply(displayState);
                musicManager.startUIUpdate(interaction.guildId, msg, interaction.channel);
            } else {
                await interaction.editReply({
                    content: `📋 Added **${playlistTitle || 'Playlist'}** — ${tracks.length} tracks queued.`,
                    flags: [4096],
                });
                setTimeout(() => {
                    interaction.deleteReply().catch(() => {});
                }, 5000);
            }
        } else {
            const track = tracks[0];
            const queue = await musicManager.enqueue(fakeInteraction, track, interaction.user);
            interaction.client.user.setActivity('YouTube.');

            const upcoming = musicManager.getUpcoming(interaction.guildId);
            const isQueued = queue.isPlaying() || queue.isPaused();
            const isActive = musicManager.uiStates.has(interaction.guildId);

            if (isQueued && isActive) {
                await interaction.editReply({
                    content: `📋 Queued **${track.title}** at position **#${upcoming.length}**.`,
                    flags: [4096],
                });
                setTimeout(() => {
                    interaction.deleteReply().catch(() => {});
                }, 5000);
                return;
            }

            // This track is now playing (AIO Unification)
            const enriched = await youtube.getVideoInfo(track.url);
            const stats = { volume: queue.volume, bitrate: queue.bitrate };
            const displayState = musicUI.buildFullDisplayState(
                enriched, [...queue.queue], 0, false, queue.autoplay, stats, null
            );

            const msg = await interaction.editReply(displayState);
            musicManager.startUIUpdate(interaction.guildId, msg, interaction.channel);
        }

    } catch (err) {
        logger.error('Music play error:', err);
        await interaction.editReply(`Failed to play: ${err.message}`);
    }
}

async function handleSearch(interaction) {
    const query = interaction.options.getString('query');
    await interaction.deferReply();

    try {
        const results = await youtube.search(query, 5);
        if (!results.length) {
            return interaction.editReply(`No results found for **${query}**.`);
        }

        const { embed, row } = musicUI.buildSearchEmbed(query, results);
        const msg = await interaction.editReply({ embeds: [embed], components: [row] });

        const collector = msg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 120_000,
        });

        collector.on('collect', async (btn) => {
            const index = parseInt(btn.customId.split('_')[2], 10);
            const track = results[index];
            if (!track) return;

            const channel = interaction.guild.channels.cache.get(btn.member?.voice?.channelId);
            if (!channel) {
                return btn.reply({ content: 'Join a voice channel first.', flags: [64] });
            }

            try {
                const fakeInteraction = {
                    guildId: btn.guildId,
                    guild: btn.guild || interaction.guild,
                    member: { voice: { channelId: channel.id } },
                };

                await musicManager.enqueue(fakeInteraction, track);
                btn.client.user.setActivity('YouTube.');
                
                await btn.deferUpdate().catch(() => {});
                await msg.delete().catch(() => {});

                // If this is now playing (no active UI yet), start the AIO UI
                const queue = musicManager.getQueue(btn.guildId);
                if (queue && queue.currentTrack && queue.currentTrack.url === track.url && !musicManager.uiStates.has(btn.guildId)) {
                    // Enrich the track info before showing the UI
                    const enriched = await youtube.getVideoInfo(track.url);
                    const displayState = musicUI.buildFullDisplayState(enriched, [], 0, false, queue.autoplay, { volume: queue.volume, bitrate: queue.bitrate }, null);

                    const msg = await btn.channel.send(displayState);
                    musicManager.startUIUpdate(btn.guildId, msg, btn.channel);
                }
            } catch (err) {
                logger.error('Search play error:', err);
                await btn.reply({ content: `Failed: ${err.message}`, flags: [64] });
            }
        });

        collector.on('end', (_, reason) => {
            if (reason === 'messageDelete') return;
            const disabledRow = new ActionRowBuilder().addComponents(
                ...row.components.map(c => ButtonBuilder.from(c).setDisabled(true)),
            );
            msg.edit({ components: [disabledRow] }).catch(() => {});
        });

    } catch (err) {
        logger.error('Music search error:', err);
        await interaction.editReply(`Search failed: ${err.message}`);
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    }
}

async function handleQueue(interaction) {
    const current = musicManager.nowPlaying(interaction.guildId);
    const upcoming = musicManager.getUpcoming(interaction.guildId);
    const embed = musicUI.buildQueueEmbed(current, upcoming);
    await interaction.reply({ embeds: [embed], flags: [64] });
}

async function executeSkip(interaction) {
    const guildId = interaction.guildId;
    const queue = musicManager.getQueue(guildId);

    if (!queue || (!queue.isPlaying() && !queue.isPaused())) {
        await interaction.reply({ content: 'Nothing is currently playing.', flags: [64] });
        setTimeout(() => { if (interaction.deleteReply) interaction.deleteReply().catch(() => {}); }, 5000);
        return;
    }

    const skipped = queue.currentTrack;
    musicManager.skip(guildId);
    await interaction.reply({
        content: `⏭ Skipped **${skipped?.title || 'current track'}**.`,
        flags: [64],
    });
    setTimeout(() => { if (interaction.deleteReply) interaction.deleteReply().catch(() => {}); }, 5000);
}

async function handleStop(interaction) {
    const guildId = interaction.guildId;
    musicManager.stop(guildId);
    interaction.client.user.setActivity(process.env.ACTIVITY || '');
    await interaction.reply({
        content: '⏹ Stopped playback and cleared the queue.',
        flags: [64],
    });
    setTimeout(() => { if (interaction.deleteReply) interaction.deleteReply().catch(() => {}); }, 5000);
}

async function handleVolume(interaction) {
    const guildId = interaction.guildId;
    const queue = musicManager.getQueue(guildId);
    if (!queue) {
        await interaction.reply({ content: 'Nothing is currently playing.', flags: [64] });
        setTimeout(() => { if (interaction.deleteReply) interaction.deleteReply().catch(() => {}); }, 5000);
        return;
    }

    const volumePercent = interaction.options.getInteger('percent');
    const volumeDec = volumePercent / 100;
    
    queue.volume = volumeDec;
    
    // Apply immediately to current resource if playing
    const state = musicManager.uiStates.get(guildId);
    if (queue.player && queue.player.state && queue.player.state.resource) {
        const resource = queue.player.state.resource;
        if (resource.volume) {
            resource.volume.setVolume(volumeDec * 0.25);
        }
    }

    // Sync AIO UI via Abstraction
    if (state && state.stageMessage) {
        const displayState = musicUI.buildFullDisplayState(
            queue.currentTrack, 
            [...queue.queue], 
            queue.getPositionSeconds(), 
            queue.isPaused(), 
            queue.autoplay, 
            { volume: queue.volume, bitrate: queue.bitrate }
        );
        await state.stageMessage.edit(displayState).catch(() => {});
    }

    await interaction.reply({
        content: `🔊 Volume set to **${volumePercent}%**.`,
        flags: [64],
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
}

async function handleAutoplay(interaction) {
    const guildId = interaction.guildId;
    const queue = musicManager.getQueue(guildId);
    if (!queue) {
        await interaction.reply({ content: 'Nothing is currently playing.', flags: [64] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return;
    }

    queue.autoplay = !queue.autoplay;
    
    // Sync AIO UI via Abstraction
    const state = musicManager.uiStates.get(guildId);
    if (state && state.stageMessage) {
        const displayState = musicUI.buildFullDisplayState(
            queue.currentTrack, 
            [...queue.queue], 
            queue.getPositionSeconds(), 
            queue.isPaused(), 
            queue.autoplay, 
            { volume: queue.volume, bitrate: queue.bitrate }
        );
        await state.stageMessage.edit(displayState).catch(() => {});
    }

    await interaction.reply({
        content: `✨ Autoplay is now **${queue.autoplay ? 'ON' : 'OFF'}**.`,
        flags: [64],
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
}

// ── Export ──

module.exports = {
    data: new SlashCommandBuilder()
        .setName('music')
        .setDescription('Play, search, and control music')
        .addSubcommand(sub =>
            sub.setName('play')
                .setDescription('Play a URL or search term (adds to queue)')
                .addStringOption(opt =>
                    opt.setName('query')
                        .setDescription('YouTube URL, playlist URL, or search term')
                        .setRequired(true))
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Voice channel to join')
                        .addChannelTypes(2)
                        .setRequired(false)),
        )
        .addSubcommand(sub =>
            sub.setName('volume')
                .setDescription('Set the music volume (default 100%)')
                .addIntegerOption(opt =>
                    opt.setName('percent')
                        .setDescription('Volume percentage (0-200)')
                        .setMinValue(0)
                        .setMaxValue(200)
                        .setRequired(true)),
        )
        .addSubcommand(sub =>
            sub.setName('autoplay')
                .setDescription('Toggle automatic playback of similar songs'),
        )
        .addSubcommand(sub =>
            sub.setName('search')
                .setDescription('Search YouTube and pick from the top 5 results')
                .addStringOption(opt =>
                    opt.setName('query')
                        .setDescription('What to search for')
                        .setRequired(true)),
        )
        .addSubcommand(sub =>
            sub.setName('queue')
                .setDescription('Show the current music queue'),
        )
        .addSubcommand(sub =>
            sub.setName('skip')
                .setDescription('Skip the current track'),
        )
        .addSubcommand(sub =>
            sub.setName('stop')
                .setDescription('Stop playback and clear the queue'),
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        switch (sub) {
            case 'play':   return handlePlay(interaction);
            case 'search': return handleSearch(interaction);
            case 'queue':  return handleQueue(interaction);
            case 'skip':   return executeSkip(interaction);
            case 'stop':   return handleStop(interaction);
            case 'volume': return handleVolume(interaction);
            case 'autoplay': return handleAutoplay(interaction);
        }
    },
};
