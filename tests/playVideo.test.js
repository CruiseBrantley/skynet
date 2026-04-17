const playVideo = require('../util/playVideo');
const { createAudioResource } = require('@discordjs/voice');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const play = require('play-dl');
const logger = require('../logger');

jest.mock('@discordjs/voice', () => ({
    createAudioResource: jest.fn().mockReturnValue('mock-audio-resource'),
    StreamType: { Raw: 'Raw' }
}));
jest.mock('child_process', () => ({
    spawn: jest.fn(),
    execFile: jest.fn()
}));
jest.mock('fs');
jest.mock('play-dl');
jest.mock('../logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
}));

describe('playVideo utilities', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fs.existsSync.mockReturnValue(false); // default to file doesn't exist
    });

    describe('extractVideoId', () => {
        test('extracts ID from standard youtube URL', () => {
            expect(playVideo.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
        });
        test('extracts ID from youtu.be URL', () => {
            expect(playVideo.extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
        });
        test('returns null for invalid url', () => {
            expect(playVideo.extractVideoId('https://example.com')).toBeNull();
        });
    });

    describe('downloadVideo', () => {
        test('resolves target path if file already exists', async () => {
            fs.existsSync.mockImplementation((path) => {
                if (path.includes('.opus')) return true;
                return false;
            });

            const path = await playVideo.downloadVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
            expect(path).toContain('dQw4w9WgXcQ.opus');
            expect(execFile).not.toHaveBeenCalled();
        });

        test('downloads video via yt-dlp if not exist', async () => {
            execFile.mockImplementation((bin, args, opts, cb) => {
                cb(null); // simulate success
            });
            fs.existsSync.mockReturnValue(false);

            const path = await playVideo.downloadVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
            expect(path).toContain('dQw4w9WgXcQ.opus');
            expect(execFile).toHaveBeenCalled();
        });

        test('retries without cookies on first error', async () => {
            let attempt = 0;
            execFile.mockImplementation((bin, args, opts, cb) => {
                if (attempt === 0) {
                    attempt++;
                    cb(new Error('Rate restricted'));
                } else {
                    cb(null); // Success on second try
                }
            });
            fs.existsSync.mockReturnValue(false); // Make sure fs checks don't block
            fs.unlinkSync.mockReturnValue(undefined);

            const promise = playVideo.downloadVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
            const path = await promise;
            
            expect(execFile).toHaveBeenCalledTimes(2);
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Retrying without cookies'));
        });
    });

    describe('analyzeLoudness', () => {
        test('returns null if file does not exist', async () => {
            fs.existsSync.mockReturnValue(false);
            const res = await playVideo.analyzeLoudness('mock.opus');
            expect(res).toBeNull();
        });

        test('returns parsed json stats on success', async () => {
            fs.existsSync.mockReturnValue(true);
            const mockProc = {
                stderr: { on: jest.fn((ev, cb) => { cb('{"input_i": "-14.0", "target_offset": "2.0"}'); }) },
                on: jest.fn((ev, cb) => { if (ev === 'close') cb(0); })
            };
            spawn.mockReturnValue(mockProc);

            const res = await playVideo.analyzeLoudness('valid.opus');
            expect(res).toEqual(expect.objectContaining({ input_i: '-14.0' }));
        });
    });

    describe('playVideo main function', () => {
        let mockProc;
        
        beforeEach(() => {
            mockProc = {
                stderr: { on: jest.fn() },
                stdout: { pipe: jest.fn() }
            };
            spawn.mockReturnValue(mockProc);
            play.stream.mockResolvedValue({ stream: 'mock-stream', type: 'mock-type' });
        });

        test('streams directly via play-dl if non-youtube URL', async () => {
            const res = await playVideo('https://soundcloud.com/track');
            expect(play.stream).toHaveBeenCalled();
            expect(createAudioResource).toHaveBeenCalledWith('mock-stream', expect.any(Object));
        });

        test('downloads and transcodes youtube video with ffmpeg', async () => {
            fs.existsSync.mockImplementation((path) => path.includes('.opus')); // mimic cached file
            const res = await playVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { seekSeconds: 10 });
            
            expect(spawn).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['-i', expect.stringContaining('dQw4w9WgXcQ.opus')]), expect.any(Object));
            expect(mockProc.stdout.pipe).toHaveBeenCalled();
            expect(createAudioResource).toHaveBeenCalled();
        });
    });
});
