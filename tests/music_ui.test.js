const musicUI = require('../util/MusicUI');
const { EmbedBuilder, ActionRowBuilder } = require('discord.js');

describe('MusicUI', () => {
    describe('formatTime', () => {
        test('formats seconds to m:ss', () => {
            expect(musicUI.formatTime(75)).toBe('1:15');
            expect(musicUI.formatTime(0)).toBe('0:00');
            expect(musicUI.formatTime(61)).toBe('1:01');
        });

        test('formats seconds to h:mm:ss', () => {
            expect(musicUI.formatTime(3661)).toBe('1:01:01');
            expect(musicUI.formatTime(7200)).toBe('2:00:00');
        });

        test('handles null/negative', () => {
            expect(musicUI.formatTime(null)).toBeNull();
            expect(musicUI.formatTime(-10)).toBeNull();
        });
    });

    describe('buildSeekBar', () => {
        test('renders progress bar with high-fidelity blocks', () => {
            const bar = musicUI.buildSeekBar(60, 300);
            expect(bar).toContain('█');
            expect(bar).toContain('┃');
            expect(bar).toContain('▒');
            expect(bar).toContain('1:00 / 5:00');
        });

        test('shows pause icon when isPaused is true', () => {
            const bar = musicUI.buildSeekBar(60, 300, true);
            expect(bar).toContain('⏸️');
        });

        test('falls back to durationless format correctly', () => {
            const bar = musicUI.buildSeekBar(45, null);
            expect(bar).toContain('⏱️ 0:45');
        });
    });

    describe('buildNowPlayingEmbed', () => {
        test('returns an array of 2 embeds if queue is empty (Banner, Player)', () => {
            const track = { title: 'Song', url: 'https://x' };
            const embeds = musicUI.buildNowPlayingEmbed(track, [], 60);

            expect(embeds).toHaveLength(2);
            expect(embeds[0]).toBeInstanceOf(EmbedBuilder); // Banner
            expect(embeds[1]).toBeInstanceOf(EmbedBuilder); // Player
        });

        test('returns an array of 3 embeds if queue has tracks', () => {
            const track = { title: 'Song', url: 'https://x' };
            const embeds = musicUI.buildNowPlayingEmbed(track, [{ title: 'Next' }], 60);

            expect(embeds).toHaveLength(3);
        });

        test('places the "Now Playing" label in the Banner (index 0)', () => {
            const track = { title: 'Song', url: 'https://x', durationSeconds: 300 };
            const [banner] = musicUI.buildNowPlayingEmbed(track, [], 60);
            
            expect(banner.data.author.name).toContain('Playing');
        });

        test('places the Technical Stats in Grid Fields (index 1)', () => {
            const track = { title: 'Song', channel: 'Artist', durationSeconds: 300, requestedBy: 'User' };
            const stats = { volume: 0.5, bitrate: 128000 };
            const [, player] = musicUI.buildNowPlayingEmbed(track, [], 60, false, stats);
            
            expect(player.data.fields).toContainEqual(expect.objectContaining({ name: '📺 Channel', value: 'Artist' }));
            expect(player.data.fields).toContainEqual(expect.objectContaining({ name: '🔊 Volume', value: '50%' }));
            expect(player.data.footer.text).toContain('Track requested by User • 🎬 Skynet Cinematic Audio');
            // Verify spacing in description
            expect(player.data.description).toContain('\n\u200B');
        });

        test('live-upgrades low-res thumbnails to HD in the Banner', () => {
            const track = { 
                title: 'Song', 
                thumbnail: 'https://i.ytimg.com/vi/abc/3.jpg' 
            };
            const [banner] = musicUI.buildNowPlayingEmbed(track, [], 0);
            
            expect(banner.data.image.url).toBe('https://i.ytimg.com/vi/abc/hqdefault.jpg');
        });
    });

    describe('Control Rows', () => {
        test('buildCoreControlRow returns single row with 4 buttons', () => {
            const row = musicUI.buildCoreControlRow(false);
            expect(row).toBeInstanceOf(ActionRowBuilder);
            expect(row.components).toHaveLength(4);
            expect(row.components[0].data.label).toBe('⏸ Pause');
        });

        test('buildQueueControlRow returns single row with 4 buttons', () => {
            const row = musicUI.buildQueueControlRow(true, 5);
            expect(row).toBeInstanceOf(ActionRowBuilder);
            expect(row.components).toHaveLength(4);
            expect(row.components[0].data.label).toContain('ON');
        });

        test('Restart Song is correctly labeled in Core row', () => {
            const row = musicUI.buildCoreControlRow(false);
            expect(row.components[3].data.label).toBe('🔄 Restart Song');
        });

        test('Remove Next is correctly labeled in Queue row', () => {
            const row = musicUI.buildQueueControlRow(false, 1);
            expect(row.components[3].data.label).toBe('🗑 Remove Next');
        });
    });

    describe('buildFullDisplayState', () => {
        test('returns a complete AIO dispatch object', () => {
            const track = { title: 'Song' };
            const state = musicUI.buildFullDisplayState(track, [], 0, false, false, { volume: 0.5 }, null);

            expect(state).toHaveProperty('embeds');
            expect(state).toHaveProperty('components');
            expect(state.embeds).toHaveLength(2); // Banner + Player
            expect(state.components).toHaveLength(2); // Logic + Queue rows
        });
    });
});
