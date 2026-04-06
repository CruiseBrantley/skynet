const { createAudioResource, StreamType } = require('@discordjs/voice');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const play = require('play-dl');
const logger = require('../logger');

const PROJECT_DIR = '/Users/cruise/git/skynet';
const YT_DLP = path.join(PROJECT_DIR, 'tts_engine/piper_venv/bin/yt-dlp');
const COOKIE_FILE = path.join(PROJECT_DIR, 'youtube_cookies.txt');
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const TEMP_DIR = path.join(PROJECT_DIR, 'temp_music');

/**
 * Get yt-dlp cookie args if the cookie file exists.
 */
function getCookieArgs() {
    return fs.existsSync(COOKIE_FILE) ? ['--cookies', COOKIE_FILE] : [];
}

/**
 * Extract YouTube video ID from URL.
 */
function extractVideoId(url) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * Downloads a YouTube video's audio to a local temp file.
 * Returns the absolute path to the downloaded file.
 */
async function downloadVideo(url) {
    const videoId = extractVideoId(url);
    if (!videoId) throw new Error('Could not extract video ID');

    const targetPath = path.join(TEMP_DIR, `${videoId}.opus`);

    if (fs.existsSync(targetPath)) {
        logger.info(`Using cached audio for ${videoId}`);
        return targetPath;
    }

    logger.info(`Downloading audio for ${videoId}...`);
    return new Promise((resolve, reject) => {
        const args = [
            ...getCookieArgs(),
            '--js-runtimes', 'node',
            '--remote-components', 'ejs:github',
            '-f', 'bestaudio',
            '-x', '--audio-format', 'opus',
            '-o', targetPath,
            url,
        ];

        execFile(YT_DLP, args, {
            env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin` },
        }, (err) => {
            if (err) return reject(new Error(`yt-dlp download failed: ${err.message}`));
            resolve(targetPath);
        });
    });
}

/**
 * Creates an AudioResource for a given URL using download-then-play strategy for YouTube.
 * @param {string} url - The URL to play
 * @param {object} [opts]
 * @param {number} [opts.seekSeconds=0] - Start playback from this many seconds in.
 * @param {number} [opts.bitrate=64000] - Target bitrate in bps (default 64k).
 * @returns {Promise<AudioResource>}
 */
async function playVideo(url, { seekSeconds = 0, bitrate = 64000 } = {}) {
    logger.info(`Creating AudioResource for: ${url}${seekSeconds ? ` (seek: ${seekSeconds}s)` : ''} at ${Math.round(bitrate / 1000)}kbps`);

    try {
        let sourcePath;
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            sourcePath = await downloadVideo(url);
        } else {
            // Fallback for non-YouTube
            logger.info('Non-YouTube URL, using play-dl direct stream...');
            const stream = await play.stream(url);
            return createAudioResource(stream.stream, {
                inputType: stream.type,
                inlineVolume: false,
            });
        }

        // Use ffmpeg to stream from the local file (allows for easy seeking and stable transcoding)
        // Optimization: Use libopus with high complexity, explicit bitrate, and loudness normalization.
        const ffmpegArgs = [
            '-ss', String(seekSeconds),
            '-i', sourcePath,
            '-vn',
            '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
            '-c:a', 'libopus',
            '-b:a', String(bitrate),
            '-vbr', 'on',
            '-compression_level', '10',
            '-application', 'audio',
            '-f', 'opus',
            '-',
        ];

        const ffmpegProcess = spawn(FFMPEG, ffmpegArgs, {
            env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin` },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        ffmpegProcess.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg.includes('Error') || msg.includes('error')) {
                logger.warn(`ffmpeg: ${msg}`);
            }
        });

        return createAudioResource(ffmpegProcess.stdout, {
            inputType: StreamType.Arbitrary,
            inlineVolume: true,
        });

    } catch (err) {
        logger.error(`Resource Creation Error: ${err.message}`);
        throw err;
    }
}

module.exports = playVideo;
module.exports.extractVideoId = extractVideoId;
module.exports.downloadVideo = downloadVideo;