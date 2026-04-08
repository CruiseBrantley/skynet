const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const decode = require('unescape');

/**
 * Format seconds as m:ss or h:mm:ss.
 */
function formatTime(totalSeconds) {
    if (totalSeconds == null || totalSeconds < 0) return null;
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Normalizes a YouTube thumbnail URL to its maximum resolution.
 * Catch-all for default, hq, and numbered frame fallbacks.
 */
function normalizeThumbnail(url) {
    if (!url || !url.includes('ytimg.com')) return url;
    
    // Catch default placeholders and numbered frames (0.jpg - 3.jpg)
    // Strip query strings to ensure a clean HD bypass
    const lowResRegex = /\/(default|mqdefault|[0-3])\.jpg(\?.*)?$/;
    if (lowResRegex.test(url) && !url.includes('maxresdefault') && !url.includes('hqdefault') && !url.includes('sddefault')) {
        return url.replace(lowResRegex, '/hqdefault.jpg');
    }
    return url;
}

/**
 * Build a visual seek bar.
 */
function buildSeekBar(position, duration, isPaused = false, barLength = 18) {
    const posStr = formatTime(position) || '0:00';
    const statusIcon = isPaused ? '⏸️' : '▶️';

    if (!duration || duration <= 0) {
        return `${statusIcon}  ⏱️ ${posStr}`;
    }

    const durStr = formatTime(duration);
    const fraction = Math.min(position / duration, 1);
    const filledCount = Math.round(fraction * barLength);

    const full = '█'.repeat(Math.max(0, filledCount));
    const empty = '▒'.repeat(Math.max(0, barLength - filledCount));
    
    return `${statusIcon}  ${full}┃${empty}  ${posStr} / ${durStr}`;
}

/**
 * Build the "Now Playing" UI as a dual-stage card (Array of 2 embeds).
 * Stage 0: Visual Billboard (Title, Image, Seek Bar)
 * Stage 1: Technical Dashboard (Channel, Stats, Up Next)
 */
function buildNowPlayingEmbed(track, upcoming, positionSeconds, isPaused = false, stats = null, lyrics = null) {
    const mainColor = isPaused ? 0xFEE75C : 0x5865F2;

    // --- STAGE 0: The Banner Card (Label & HD Image) ---
    const bannerEmbed = new EmbedBuilder()
        .setColor(mainColor)
        .setAuthor({ name: isPaused ? '⏸ Paused' : '🎵 Now Playing' });
    
    if (track.thumbnail) {
        bannerEmbed.setImage(normalizeThumbnail(track.thumbnail));
    }

    // --- STAGE 1: The Player Card (Title, Seek Bar & Stats) ---
    const playerEmbed = new EmbedBuilder()
        .setColor(mainColor)
        .setTitle(track.title || track.url)
        .setURL(track.url);
    
    if (typeof positionSeconds === 'number') {
        const seekBar = buildSeekBar(positionSeconds, track.durationSeconds || null, isPaused);
        // Add a newline to create space below the bar
        playerEmbed.setDescription(`${seekBar}\n\u200B`);
    }

    // Individual Points (Grid View - Optimized 3-wide)
    playerEmbed.addFields(
        { name: '📺 Channel', value: track.channel || 'Unknown', inline: true }
    );

    if (stats) {
        const volPercent = Math.round((stats.volume || 0) * 100);
        const bitrateKbps = Math.round((stats.bitrate || 0) / 1000);
        playerEmbed.addFields(
            { name: '🔊 Volume', value: `${volPercent}%`, inline: true },
            { name: '📶 Bitrate', value: `${bitrateKbps}kbps`, inline: true }
        );
    }

    // --- STAGE 2: The Queue Dashboard (CONDITIONAL) ---
    let dashboardEmbed = null;
    if (upcoming && upcoming.length > 0) {
        dashboardEmbed = new EmbedBuilder().setColor(mainColor);
        const queueParts = [];
        queueParts.push('**Up Next**');
        const next = upcoming.slice(0, 3).map((t, i) => `\`${i + 1}.\` ${t.title}`).join('\n');
        const extra = upcoming.length > 3 ? `\n*...and ${upcoming.length - 3} more*` : '';
        queueParts.push(next + extra);
        dashboardEmbed.setDescription(queueParts.join('\n'));
    }

    // --- STAGE 3: The Lyrics Panel (CONDITIONAL) ---
    let lyricsEmbed = null;
    if (lyrics) {
        lyricsEmbed = new EmbedBuilder()
            .setColor(mainColor)
            .setTitle(`📜 Lyrics: ${track.title}`)
            .setDescription(lyrics.length > 4000 ? lyrics.substring(0, 4000) + '...' : lyrics);
    }

    // Final Footer Consolidation (Pinned to bottom)
    const lastEmbed = lyricsEmbed || dashboardEmbed || playerEmbed;
    const requester = track.requestedBy ? `👤 Track requested by ${track.requestedBy}` : '✨ AI Discovery';
    lastEmbed.setFooter({ text: `${requester} • 🎬 Skynet Cinematic Audio` });

    return [bannerEmbed, playerEmbed, dashboardEmbed, lyricsEmbed].filter(Boolean);
}

/**
 * Build the core playback control button row (Message 1).
 */
function buildCoreControlRow(isPaused) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('music_pause')
            .setLabel(isPaused ? '▶ Resume' : '⏸ Pause')
            .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_skip')
            .setLabel('⏭ Skip')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('music_stop')
            .setLabel('⏹ Stop')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('music_restart')
            .setLabel('🔄 Restart Song')
            .setStyle(ButtonStyle.Secondary),
    );
}

/**
 * Build the queue-related button row (Message 2).
 */
function buildQueueControlRow(autoplay = false, queueLength = 0) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('music_autoplay')
            .setLabel(`✨ Autoplay: ${autoplay ? 'ON' : 'OFF'}`)
            .setStyle(autoplay ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_lyrics')
            .setLabel('🎙 Lyrics')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_shuffle')
            .setLabel('🔀 Shuffle')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(queueLength <= 1),
        new ButtonBuilder()
            .setCustomId('music_skip_next')
            .setLabel('🗑 Remove Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(queueLength === 0),
    );
}

/**
 * Build the search results embed + button rows.
 */
function buildSearchEmbed(query, results) {
    const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '🔎 YouTube Search Results' })
        .setTitle(`Results for: ${query}`)
        .setDescription(
            results.map((r, i) =>
                `\`${i + 1}.\` **[${decode(r.title)}](${r.link})**\n${decode(r.channelTitle || '')}`,
            ).join('\n\n'),
        );

    const styles = [
        ButtonStyle.Success,
        ButtonStyle.Primary,
        ButtonStyle.Secondary,
        ButtonStyle.Secondary,
        ButtonStyle.Danger,
    ];

    const row = new ActionRowBuilder().addComponents(
        ...results.map((_, i) =>
            new ButtonBuilder()
                .setCustomId(`music_search_${i}`)
                .setLabel(`${i + 1}`)
                .setStyle(styles[i] || ButtonStyle.Secondary),
        ),
    );

    return { embed, row };
}

/**
 * Build the queue display embed.
 */
function buildQueueEmbed(current, upcoming) {
    if (!current && (!upcoming || upcoming.length === 0)) {
        return new EmbedBuilder()
            .setColor(0x99AAB5)
            .setDescription('The queue is empty. Use `/music play` to add tracks.');
    }

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: '📋 Music Queue' });

    if (current) {
        embed.addFields({
            name: '▶ Now Playing',
            value: `**${current.title}**${current.channel ? ` — ${current.channel}` : ''}`,
        });
    }

    if (upcoming && upcoming.length > 0) {
        const lines = upcoming.slice(0, 10).map((t, i) => `\`${i + 1}.\` ${t.title}`);
        if (upcoming.length > 10) lines.push(`…and ${upcoming.length - 10} more`);
        embed.addFields({ name: `Up Next (${upcoming.length})`, value: lines.join('\n') });
    }

    return embed;
}
/**
 * Abstraction: Returns the full AIO Display State for the player.
 * Encapsulates embeds and button rows into a single dispatch-ready object.
 */
function buildFullDisplayState(track, upcoming, positionSeconds, isPaused, autoplay, stats, lyrics = null) {
    const embeds = buildNowPlayingEmbed(track, upcoming, positionSeconds, isPaused, stats, lyrics);
    const coreRow = buildCoreControlRow(isPaused);
    const queueRow = buildQueueControlRow(autoplay, upcoming.length);

    return {
        content: '',
        embeds,
        components: [coreRow, queueRow]
    };
}

module.exports = {
    formatTime,
    buildSeekBar,
    buildNowPlayingEmbed,
    buildCoreControlRow,
    buildQueueControlRow,
    buildSearchEmbed,
    buildQueueEmbed,
    normalizeThumbnail,
    buildFullDisplayState,
};
