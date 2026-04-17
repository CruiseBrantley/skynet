const speak = require('../commands/speak');
const { getVoiceConnection, joinVoiceChannel, createAudioPlayer, createAudioResource, VoiceConnectionStatus } = require('@discordjs/voice');
const logger = require('../logger');
const fs = require('fs');
const util = require('util');
const exec = require('child_process').exec;

jest.mock('@discordjs/voice');
jest.mock('../logger', () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('fs');
jest.mock('child_process', () => ({
    exec: jest.fn((cmd, cb) => cb(null, { stdout: '', stderr: '' }))
}));
jest.mock('../util/MusicManager', () => ({
    getQueue: jest.fn().mockReturnValue(null), // Default no music playing
}));

describe('speak command', () => {
    let mockInteraction;
    let mockConnection;
    let mockPlayer;
    let mockChannel;

    beforeEach(() => {
        jest.clearAllMocks();

        process.env.TTS_MODEL = 'test-model.onnx';

        mockPlayer = {
            play: jest.fn(),
            on: jest.fn((event, cb) => {
                if (event === 'stateChange') {
                    // simulate going idle immediately to trigger cleanup
                    setTimeout(() => cb({ status: 'playing' }, { status: 'idle' }), 0);
                }
            }),
            pause: jest.fn(),
            unpause: jest.fn(),
        };

        mockConnection = {
            state: { status: VoiceConnectionStatus.Ready },
            subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
            destroy: jest.fn(),
            on: jest.fn((ev, cb) => {
                 if (ev === VoiceConnectionStatus.Ready) setTimeout(cb, 0);
            })
        };

        createAudioPlayer.mockReturnValue(mockPlayer);
        getVoiceConnection.mockReturnValue(null);
        joinVoiceChannel.mockReturnValue(mockConnection);

        mockChannel = { id: 'channel-123', name: 'General Voice', guild: { id: 'guild-123', voiceAdapterCreator: {} } };

        mockInteraction = {
            id: 'interaction-123',
            guildId: 'guild-123',
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
            reply: jest.fn().mockResolvedValue(),
            guild: {
                id: 'guild-123',
                channels: { cache: { get: jest.fn().mockReturnValue(mockChannel) }, fetch: jest.fn() },
                members: { cache: { get: jest.fn() }, fetch: jest.fn() },
                roles: { cache: { get: jest.fn() }, fetch: jest.fn() },
            },
            member: { voice: { channelId: 'channel-123' } },
            options: {
                getString: jest.fn().mockReturnValue('Hello there'),
                getChannel: jest.fn().mockReturnValue(mockChannel),
                getMember: jest.fn().mockReturnValue(null),
            }
        };

        fs.existsSync.mockReturnValue(true);
        fs.unlinkSync.mockReturnValue(true);
    });

    test('metadata is valid', () => {
        expect(speak.data.name).toBe('speak');
    });

    test('successfully generates TTS and plays via voice connection', async () => {
        await speak.execute(mockInteraction);

        // Allow async resolution
        await new Promise(r => setTimeout(r, 10));

        expect(mockInteraction.deferReply).toHaveBeenCalled();
        const { exec } = require('child_process');
        expect(exec).toHaveBeenCalled(); // Piper execution and ffmpeg filtering

        expect(joinVoiceChannel).toHaveBeenCalledWith({
            channelId: 'channel-123',
            guildId: 'guild-123',
            adapterCreator: {},
        });
        expect(mockConnection.subscribe).toHaveBeenCalledWith(mockPlayer);
        expect(mockPlayer.play).toHaveBeenCalled();
    });

    test('fails if no voice channel is found', async () => {
        mockInteraction.options.getChannel.mockReturnValue(null);
        mockInteraction.member.voice.channelId = null; // No fallback channel
        
        await speak.execute(mockInteraction);
        
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: "You need to be in a voice channel or to specify a channel.",
            ephemeral: true
        });
    });

    test('natural translation of mentions', async () => {
        // Provide a mock user mention
        mockInteraction.options.getString.mockReturnValue('Hello <@12345>');
        mockInteraction.guild.members.cache.get.mockImplementation((id) => {
            if (id === '12345') return { nickname: 'John', user: { username: 'JohnDoe' } };
            return null;
        });

        await speak.execute(mockInteraction);

        const { exec } = require('child_process');
        expect(exec.mock.calls[0][0]).toContain('Hello John');
    });

    test('error handling unpauses music queue if active', async () => {
        const musicQueueMock = { player: { pause: jest.fn(), unpause: jest.fn() }, isPlaying: () => true };
        const MusicManager = require('../util/MusicManager');
        MusicManager.getQueue.mockReturnValueOnce(musicQueueMock);

        const { exec } = require('child_process');
        exec.mockImplementationOnce((cmd, cb) => cb(new Error('Piper Failed')));

        await speak.execute(mockInteraction);
        await new Promise(r => setTimeout(r, 10));

        expect(musicQueueMock.player.pause).toHaveBeenCalled();
        expect(musicQueueMock.player.unpause).toHaveBeenCalled(); // Unpauses on error
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Encountered an error speaking'), expect.any(Error));
    });
});
