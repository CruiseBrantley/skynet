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

    const full = '▒'.repeat(Math.max(0, filledCount));
    const empty = '█'.repeat(Math.max(0, barLength - filledCount));
    
    return `${statusIcon}  ${full}⬛${empty}  ${posStr} / ${durStr}`;
}

/**
 * Build the "Now Playing" embed for a track.
 */
function buildNowPlayingEmbed(track, upcoming, positionSeconds, isPaused = false) {
    const embed = new EmbedBuilder()
        .setColor(isPaused ? 0xFEE75C : 0x5865F2)
        .setAuthor({ name: isPaused ? '⏸ Paused' : '🎵 Now Playing' })
        .setTitle(track.title || track.url)
        .setURL(track.url);

    const lines = [];
    if (track.channel) lines.push(`**${track.channel}**`);
    if (typeof positionSeconds === 'number') {
        lines.push(buildSeekBar(positionSeconds, track.durationSeconds || null, isPaused));
    }
    if (lines.length) embed.setDescription(lines.join('\n'));

    if (track.thumbnail) embed.setThumbnail(track.thumbnail);

    if (upcoming && upcoming.length > 0) {
        const next = upcoming.slice(0, 3).map((t, i) => `\`${i + 1}.\` ${t.title}`).join('\n');
        const extra = upcoming.length > 3 ? `\n…and ${upcoming.length - 3} more` : '';
        embed.addFields({ name: 'Up Next', value: next + extra });
    }

    return embed;
}

/**
 * Build the playback control button row.
 */
function buildControlRow(isPaused, autoplay = false, queueLength = 0) {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('music_pause')
            .setLabel(isPaused ? '▶ Resume' : '⏸ Pause')
            .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_skip')
            .setLabel('⏭ Skip')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('music_skip_next')
            .setLabel('⏭ Skip Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(queueLength === 0),
        new ButtonBuilder()
            .setCustomId('music_stop')
            .setLabel('⏹ Stop')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('music_restart')
            .setLabel('🔄 Restart')
            .setStyle(ButtonStyle.Secondary),
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('music_shuffle')
            .setLabel('🔀 Shuffle Queue')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(queueLength <= 1),
        new ButtonBuilder()
            .setCustomId('music_autoplay')
            .setLabel(`✨ Autoplay: ${autoplay ? 'ON' : 'OFF'}`)
            .setStyle(autoplay ? ButtonStyle.Success : ButtonStyle.Secondary),
    );

    return [row1, row2];
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

module.exports = {
    formatTime,
    buildSeekBar,
    buildNowPlayingEmbed,
    buildControlRow,
    buildSearchEmbed,
    buildQueueEmbed,
};
