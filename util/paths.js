const path = require('path');
const fs = require('fs');

/**
 * Centrally manages absolute and relative paths for the project's binaries and directories.
 * This avoids hardcoded absolute paths that fail in CI/CD environments.
 */

const PROJECT_ROOT = process.cwd();
const TEMP_DIR = path.join(PROJECT_ROOT, 'temp_music');
const COOKIE_FILE = path.join(PROJECT_ROOT, 'youtube_cookies.txt');

// 1. Resolve yt-dlp path
// Strategy: Check local venv first, then system path
let resolvedYtDlp = 'yt-dlp';
const localVenvYtDlp = path.join(PROJECT_ROOT, 'tts_engine/piper_venv/bin/yt-dlp');
if (fs.existsSync(localVenvYtDlp)) {
    resolvedYtDlp = localVenvYtDlp;
}

// 2. Resolve ffmpeg path
// Strategy: Check Mac homebrew path, then system path
let resolvedFfmpeg = 'ffmpeg';
const macHomebrewFfmpeg = '/opt/homebrew/bin/ffmpeg';
if (fs.existsSync(macHomebrewFfmpeg)) {
    resolvedFfmpeg = macHomebrewFfmpeg;
}

module.exports = {
    PROJECT_ROOT,
    TEMP_DIR,
    COOKIE_FILE,
    YT_DLP: resolvedYtDlp,
    FFMPEG: resolvedFfmpeg
};
