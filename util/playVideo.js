const { createAudioResource, StreamType } = require('@discordjs/voice');
const { spawn, execFile } = require('child_process');
const { PassThrough } = require('stream');
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
async function downloadVideo(url, allowCookies = true) {
    const videoId = extractVideoId(url);
    if (!videoId) throw new Error('Could not extract video ID');

    const targetPath = path.join(TEMP_DIR, `${videoId}.opus`);

    if (fs.existsSync(targetPath)) {
        logger.info(`Using cached audio for ${videoId}`);
        return targetPath;
    }

    logger.info(`Downloading audio for ${videoId} (cookies: ${allowCookies})...`);
    return new Promise((resolve, reject) => {
        const cookies = allowCookies ? getCookieArgs() : [];
        const args = [
            ...cookies,
            '--js-runtimes', 'node:/opt/homebrew/bin/node',
            '--remote-components', 'ejs:github',
            '--no-playlist', // Prevent yt-dlp from downloading an entire playlist if the URL contains a list= ID
            '-f', 'bestaudio',
            '-x', '--audio-format', 'opus',
            '--write-info-json', // Write metadata alongside the audio
            '-o', targetPath,
            url,
        ];

        execFile(YT_DLP, args, {
            env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin` },
        }, (err) => {
            const infoPath = targetPath.replace('.opus', '.info.json');

            if (err) {
                if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
                if (fs.existsSync(infoPath)) fs.unlinkSync(infoPath);
                if (allowCookies) {
                    logger.warn(`yt-dlp download failed with cookies (possibly rate-limited). Retrying without cookies...`);
                    return resolve(downloadVideo(url, false));
                }
                return reject(new Error(`yt-dlp download failed: ${err.message}`));
            }

            // Successfully downloaded, now intercept and cache the rich metadata native to yt-dlp
            if (fs.existsSync(infoPath)) {
                try {
                    const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
                    const youtube = require('./YouTubeMetadata');
                    
                    const enrichedData = {
                        title: info.title,
                        channel: info.uploader || info.channel || null,
                        thumbnail: info.thumbnails?.[0]?.url || info.thumbnail || null,
                        durationSeconds: info.duration || null,
                    };
                    
                    // Merge with any existing cached loudnorm stats so we don't drop them
                    const existing = youtube.cache.get(videoId) || {};
                    youtube._updateCache(videoId, { ...existing, ...enrichedData });
                    
                    logger.info(`Natively captured metadata for ${videoId} from yt-dlp extraction phase.`);
                } catch (parseErr) {
                    logger.warn(`Failed to parse yt-dlp info json for ${videoId}: ${parseErr.message}`);
                } finally {
                    try { fs.unlinkSync(infoPath); } catch (e) {} // Always clean up temp json
                }
            }

            resolve(targetPath);
        });
    });
}

/**
 * Run a fast analysis pass to get loudness measurements.
 */
async function analyzeLoudness(filePath) {
    if (!fs.existsSync(filePath)) return null;

    return new Promise((resolve) => {
        // Run first-pass analysis
        const args = [
            '-i', filePath,
            '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
            '-f', 'null',
            '-',
        ];

        const proc = spawn(FFMPEG, args, {
            env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin` },
        });

        let jsonOutput = '';
        proc.stderr.on('data', (data) => {
            const str = data.toString();
            // Look for the JSON block in the stderr output
            const match = str.match(/\{[\s\S]*\}/);
            if (match) jsonOutput += match[0];
        });

        proc.on('close', (code) => {
            if (code === 0 && jsonOutput) {
                try {
                    const stats = JSON.parse(jsonOutput);
                    resolve({
                        input_i: stats.input_i,
                        input_tp: stats.input_tp,
                        input_lra: stats.input_lra,
                        input_thresh: stats.input_thresh,
                        target_offset: stats.target_offset,
                    });
                } catch (e) {
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        });
    });
}

/**
 * Creates an AudioResource for a given URL using download-then-play strategy for YouTube.
 * @param {string} url - The URL to play
 * @param {object} [opts]
 * @param {number} [opts.seekSeconds=0] - Start playback from this many seconds in.
 * @param {number} [opts.bitrate=64000] - Target bitrate in bps (default 64k).
 * @param {object} [opts.loudnorm] - Measured loudness stats for linear normalization.
 * @returns {Promise<AudioResource>}
 */
async function playVideo(url, { seekSeconds = 0, bitrate = 64000, loudnorm = null } = {}) {
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

        // Build loudnorm filter (Dynamic fallback OR Linear dual-pass)
        let lnFilter = 'loudnorm=I=-16:TP=-1.5:LRA=11';
        if (loudnorm) {
            lnFilter = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${loudnorm.input_i}:measured_TP=${loudnorm.input_tp}:measured_LRA=${loudnorm.input_lra}:measured_thresh=${loudnorm.input_thresh}:offset=${loudnorm.target_offset}:linear=true`;
            logger.info(`Applying Linear (Dual-Pass) Normalization.`);
        }

        // Use ffmpeg to stream from the local file (allows for easy seeking and stable transcoding)
        // High-Reliability Mode: Use Raw PCM (s16le) to avoid any container or demuxing issues.
        const ffmpegArgs = [
            '-ss', String(seekSeconds),
            '-i', sourcePath,
            '-vn',
            '-af', lnFilter,
            '-f', 's16le',
            '-ac', '2',
            '-ar', '48000',
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

        // Insert a high-capacity buffer between ffmpeg and Discord.js to prevent stream starvation hitches
        const bufferStream = new PassThrough({ highWaterMark: 1024 * 1024 * 5 }); // 5 MB buffer (~26 seconds of PCM audio)
        ffmpegProcess.stdout.pipe(bufferStream);

        return createAudioResource(bufferStream, {
            inputType: StreamType.Raw,
            inlineVolume: true,
            silencePaddingFrames: 10, // Increase padding frames slightly to handle sudden hitches
        });

    } catch (err) {
        logger.error(`Resource Creation Error: ${err.message}`);
        throw err;
    }
}

module.exports = playVideo;
module.exports.extractVideoId = extractVideoId;
module.exports.downloadVideo = downloadVideo;
module.exports.analyzeLoudness = analyzeLoudness;