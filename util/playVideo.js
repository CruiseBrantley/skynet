const { createAudioResource, StreamType } = require('@discordjs/voice');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const play = require('play-dl');
const logger = require('../logger');

const PROJECT_DIR = '/Users/cruise/git/skynet';
const YT_DLP = path.join(PROJECT_DIR, 'tts_engine/piper_venv/bin/yt-dlp');
const COOKIE_FILE = path.join(PROJECT_DIR, 'youtube_cookies.txt');

/**
 * Creates an AudioResource for a given URL using yt-dlp or play-dl fallback.
 * @param {string} url - The URL to play
 * @returns {Promise<AudioResource>}
 */
module.exports = async function playVideo (url) {
    logger.info(`Creating AudioResource for: ${url}`);
    
    try {
        // Use yt-dlp to stream directly if it's a YouTube link
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            logger.info('YouTube detected, spawning yt-dlp...');
            const cookieArg = fs.existsSync(COOKIE_FILE) ? ['--cookies', COOKIE_FILE] : [];
            const args = [
                ...cookieArg,
                '--js-runtimes', 'node',
                '--remote-components', 'ejs:github',
                '-f', 'bestaudio',
                '-o', '-',
                url
            ];
            
            const ytDlpProcess = spawn(YT_DLP, args, {
                env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin` }
            });

            ytDlpProcess.stderr.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg.includes('ERROR') || msg.includes('Warning')) {
                    logger.warn(`yt-dlp: ${msg}`);
                }
            });

            const resource = createAudioResource(ytDlpProcess.stdout, {
                inputType: StreamType.Arbitrary,
                inlineVolume: false
            });

            return resource;
        } else {
            // Fallback to play-dl for non-YouTube links
            logger.info('Non-YouTube URL, using play-dl...');
            const stream = await play.stream(url);
            return createAudioResource(stream.stream, {
                inputType: stream.type,
                inlineVolume: false
            });
        }
    } catch (err) {
        logger.error(`Resource Creation Error: ${err.message}`);
        throw err;
    }
}