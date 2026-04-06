jest.mock('../util/MusicManager', () => ({
    enqueue: jest.fn(),
    enqueueBatch: jest.fn(),
    getQueue: jest.fn(),
    getUpcoming: jest.fn().mockReturnValue([]),
    nowPlaying: jest.fn(),
    skip: jest.fn(),
    stop: jest.fn(),
    uiStates: { has: jest.fn().mockReturnValue(true) },
    startUIUpdate: jest.fn(),
}));

jest.mock('../util/MusicUI', () => ({
    buildNowPlayingEmbed: jest.fn().mockReturnValue({ setAuthor: jest.fn().mockReturnThis(), setDescription: jest.fn().mockReturnThis() }),
    buildControlRow: jest.fn().mockReturnValue([]),
    buildSearchEmbed: jest.fn().mockReturnValue({ embed: {}, row: {} }),
    buildQueueEmbed: jest.fn().mockReturnValue({}),
}));

jest.mock('../util/YouTubeMetadata', () => ({
    isYouTubeURL: jest.fn(),
    isPlaylistURL: jest.fn(),
    search: jest.fn(),
    getVideoInfo: jest.fn(),
    expandPlaylist: jest.fn(),
}));

jest.mock('../logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
}));

const musicCmd = require('../commands/music');
const musicManager = require('../util/MusicManager');
const musicUI = require('../util/MusicUI');
const youtube = require('../util/YouTubeMetadata');

function mockInteraction(subcommand, options = {}) {
    const optionValues = { ...options };
    return {
        guildId: 'guild-123',
        guild: {
            voiceAdapterCreator: jest.fn(),
            channels: {
                cache: {
                    get: jest.fn().mockReturnValue({ id: 'vc-1', name: 'General' }),
                },
            },
        },
        member: { voice: { channelId: 'vc-1' } },
        client: { user: { setActivity: jest.fn() } },
        options: {
            getSubcommand: () => subcommand,
            getString: (key) => optionValues[key] || null,
            getChannel: (key) => optionValues[key] || null,
        },
        reply: jest.fn().mockResolvedValue(),
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue({
            createMessageComponentCollector: jest.fn().mockReturnValue({
                on: jest.fn(),
            }),
        }),
    };
}

describe('/music Command Integration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('play subcommand', () => {
        test('plays a direct video URL', async () => {
            const interaction = mockInteraction('play', { query: 'https://youtube.com/watch?v=abc' });
            youtube.isYouTubeURL.mockReturnValue(true);
            youtube.isPlaylistURL.mockReturnValue(false);
            youtube.getVideoInfo.mockResolvedValue({ title: 'Test Video', url: 'https://abc' });
            musicManager.enqueue.mockResolvedValue({ isPlaying: () => false, isPaused: () => false });

            await musicCmd.execute(interaction);

            expect(youtube.getVideoInfo).toHaveBeenCalledWith('https://youtube.com/watch?v=abc');
            expect(musicManager.enqueue).toHaveBeenCalled();
            expect(musicUI.buildNowPlayingEmbed).toHaveBeenCalled();
        });

        test('handles searches', async () => {
            const interaction = mockInteraction('play', { query: 'lofi beats' });
            youtube.isYouTubeURL.mockReturnValue(false);
            youtube.search.mockResolvedValue([{ title: 'Search Result', url: 'https://res' }]);
            musicManager.enqueue.mockResolvedValue({ isPlaying: () => false, isPaused: () => false });

            await musicCmd.execute(interaction);

            expect(youtube.search).toHaveBeenCalledWith('lofi beats', 1);
            expect(musicManager.enqueue).toHaveBeenCalled();
        });
    });

    describe('skip subcommand', () => {
        test('calls skip on the manager', async () => {
            const interaction = mockInteraction('skip');
            musicManager.getQueue.mockReturnValue({ isPlaying: () => true, currentTrack: { title: 'Song' } });

            await musicCmd.execute(interaction);

            expect(musicManager.skip).toHaveBeenCalledWith('guild-123');
            expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
                content: expect.stringContaining('Skipped'),
                flags: [64],
            }));
        });
    });

    describe('stop subcommand', () => {
        test('calls stop on the manager', async () => {
            const interaction = mockInteraction('stop');

            await musicCmd.execute(interaction);

            expect(musicManager.stop).toHaveBeenCalledWith('guild-123');
            expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
                content: expect.stringContaining('Stopped'),
                flags: [64],
            }));
        });
    });
});
