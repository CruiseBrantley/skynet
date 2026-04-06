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
        test('renders progress bar with knob', () => {
            const bar = musicUI.buildSeekBar(60, 300, 10);
            expect(bar).toContain('🔘');
            expect(bar).toContain('1:00 / 5:00');
        });

        test('falls back to stopwatch icon without duration', () => {
            const bar = musicUI.buildSeekBar(45, null);
            expect(bar).toContain('⏱️ 0:45');
        });
    });

    describe('buildNowPlayingEmbed', () => {
        test('creates valid embed structure', () => {
            const track = { title: 'Song', url: 'https://x', channel: 'Artist', durationSeconds: 300 };
            const upcoming = [{ title: 'Next' }];
            const embed = musicUI.buildNowPlayingEmbed(track, upcoming, 60);

            expect(embed).toBeInstanceOf(EmbedBuilder);
            expect(embed.data.title).toBe('Song');
            expect(embed.data.description).toContain('Artist');
            expect(embed.data.description).toContain('1:00 / 5:00');
            expect(embed.data.fields).toHaveLength(1);
            expect(embed.data.fields[0].name).toBe('Up Next');
        });
    });

    describe('buildControlRow', () => {
        test('returns array with one action row', () => {
            const rows = musicUI.buildControlRow(false);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toBeInstanceOf(ActionRowBuilder);
            expect(rows[0].components).toHaveLength(4);
        });

        test('toggles pause/resume label and includes Restart', () => {
            const row1 = musicUI.buildControlRow(false);
            expect(row1[0].components[0].data.label).toBe('⏸ Pause');
            expect(row1[0].components[3].data.label).toBe('🔄 Restart');
            
            const row2 = musicUI.buildControlRow(true);
            expect(row2[0].components[0].data.label).toBe('▶ Resume');
        });
    });
});
