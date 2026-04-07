const fs = require('fs');
const path = require('path');
const youtubeSearch = require('youtube-search');
const ytpl = require('ytpl');
const logger = require('../logger');

const CACHE_FILE = path.join(__dirname, '../metadata_cache.json');

/**
 * Unified wrapper for YouTube metadata and search results.
 * Implements a persistent cache to reduce API calls and speed up response times.
 */
class YouTubeMetadata {
    constructor() {
        /** @type {Map<string, object>} */
        this.cache = new Map();
        
        this.searchOptions = {
            maxResults: 5,
            key: process.env.YOUTUBE_KEY,
            type: 'video',
        };

        this._loadCache();
    }

    _loadCache() {
        if (fs.existsSync(CACHE_FILE)) {
            try {
                const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
                this.cache = new Map(Object.entries(data));
                logger.info(`Loaded ${this.cache.size} entries from metadata cache.`);
            } catch (err) {
                logger.warn(`Failed to load metadata cache: ${err.message}`);
            }
        }
    }

    _saveCache() {
        try {
            const data = Object.fromEntries(this.cache);
            fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
        } catch (err) {
            logger.warn(`Failed to save metadata cache: ${err.message}`);
        }
    }

    /**
     * Store loudness normalization stats for a video.
     */
    setLoudnormStats(videoId, stats) {
        if (!videoId) return;
        const info = this.cache.get(videoId) || {};
        this._updateCache(videoId, { ...info, loudnorm: stats });
    }

    /**
     * Cache a video's metadata and trigger a persistent save.
     */
    _updateCache(videoId, info) {
        this.cache.set(videoId, info);
        this._saveCache();
    }

    /**
     * Search YouTube and return the top N results.
     */
    async search(query, maxResults = 5) {
        if (!process.env.YOUTUBE_KEY) {
            throw new Error('YOUTUBE_KEY is missing from environment variables.');
        }

        const options = { ...this.searchOptions, maxResults };
        
        return new Promise((resolve, reject) => {
            youtubeSearch(query, options, (err, results) => {
                if (err) return reject(err);
                const processed = (results || []).map(r => ({
                    url: r.link,
                    title: r.title,
                    channel: r.channelTitle,
                    thumbnail: r.thumbnails?.high?.url || r.thumbnails?.default?.url || null,
                }));
                resolve(processed);
            });
        });
    }

    /**
     * Expand a YouTube playlist URL into a list of track objects.
     */
    async expandPlaylist(url) {
        try {
            const playlist = await ytpl(url, { pages: 1 });
            return {
                title: playlist.title,
                tracks: playlist.items.map(item => ({
                    url: item.shortUrl || item.url,
                    title: item.title,
                    channel: item.author?.name || 'Unknown',
                    thumbnail: item.bestThumbnail?.url || null,
                }))
            };
        } catch (err) {
            // Fallback for Mixes or other unsupported dynamic playlists using yt-dlp
            logger.warn(`Could not expand playlist ${url} with ytpl, falling back to yt-dlp: ${err.message}`);
            
            try {
                const { execFile } = require('child_process');
                const YT_DLP = path.join(__dirname, '../tts_engine/piper_venv/bin/yt-dlp');
                
                const ytData = await new Promise((resolve, reject) => {
                    execFile(YT_DLP, ['--flat-playlist', '-J', url], { maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
                        if (error) return reject(error);
                        try {
                            resolve(JSON.parse(stdout));
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
                
                if (ytData && ytData.entries && ytData.entries.length > 0) {
                    logger.info(`yt-dlp successfully parsed playlist with ${ytData.entries.length} tracks.`);
                    return {
                        title: ytData.title || 'YouTube Mix',
                        tracks: ytData.entries.map(item => ({
                            url: item.url,
                            title: item.title,
                            channel: item.uploader || item.channel || 'Unknown',
                            thumbnail: item.thumbnails?.[0]?.url || null,
                            durationSeconds: item.duration || null,
                        }))
                    };
                }
            } catch (fallbackErr) {
                logger.warn(`yt-dlp playlist fallback also failed: ${fallbackErr.message}`);
            }

            // Ultimate fallback to single video
            const videoId = this.extractVideoId(url);
            if (videoId) {
                const info = await this.getVideoInfo(url);
                return {
                    title: info.title || 'YouTube Mix Video',
                    tracks: [{
                        url: url,
                        title: info.title,
                        channel: info.channel,
                        thumbnail: info.thumbnail,
                        durationSeconds: info.durationSeconds
                    }]
                };
            }
            throw err;
        }
    }

    /**
     * Get metadata for a single video. Uses cache if available.
     */
    async getVideoInfo(url) {
        const videoId = this.extractVideoId(url);
        if (!videoId) return { url, title: url };

        if (this.cache.has(videoId)) {
            logger.info(`Metadata cache hit for ${videoId}`);
            return { ...this.cache.get(videoId), url };
        }

        if (!process.env.YOUTUBE_KEY) {
            return { url, title: url };
        }

        try {
            const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${process.env.YOUTUBE_KEY}`;
            const res = await fetch(apiUrl);
            const data = await res.json();
            const item = data.items?.[0];

            if (!item) return { url, title: url };

            const info = {
                title: item.snippet.title || url,
                channel: item.snippet.channelTitle || null,
                thumbnail: item.snippet.thumbnails?.high?.url
                    || item.snippet.thumbnails?.default?.url
                    || null,
                durationSeconds: this._parseISO8601Duration(item.contentDetails?.duration) || null,
            };

            this._updateCache(videoId, info);
            return { ...info, url };
        } catch (err) {
            logger.warn(`getVideoInfo failed for ${videoId}: ${err.message}`);
            return { url, title: url };
        }
    }

    /**
     * Get a recommended song based on the last played track.
     * Uses an LLM to generate a highly intelligent, genre-aware recommendation.
     */
    async getRecommendation(lastTrack, history = new Set()) {
        if (!lastTrack || !lastTrack.title) return null;
        
        try {
            const { queryOllama } = require('./ollama');
            const cleanTitle = lastTrack.title.replace(/(\(|\[).*(\)|\])/g, '').trim();
            const artistContext = lastTrack.channel ? ` (uploaded by ${lastTrack.channel})` : '';

            const seed = Math.floor(Math.random() * 1000000);
            logger.info(`Getting AI recommendation based on ${cleanTitle} (Seed: ${seed})...`);
            const prompt = `You are an expert DJ AI. The user just listened to the song "${cleanTitle}"${artistContext}.
Recommend exactly ONE highly similar, great song by a DIFFERENT artist that fits the exact same mood, genre, and vibe.
CRITICAL INSTRUCTION: The recommendation MUST be firmly within the exact same musical genre and vibe as the current song. To prevent loops, pick a different artist and a different track within this exact same genre.
Reply with ONLY the song title and artist name in this format: "Artist - Title". Do NOT include any other text, formatting, quotes, or explanations.`;

            let aiSuggestion = '';
            try {
                const result = await queryOllama('/api/generate', { 
                    prompt, 
                    options: { temperature: 0.9, seed } 
                });
                aiSuggestion = result.response.trim().replace(/["']/g, '');
                logger.info(`AI suggested: ${aiSuggestion}`);
            } catch (llmErr) {
                logger.warn(`AI recommendation failed, falling back to basic YouTube search: ${llmErr.message}`);
                aiSuggestion = `related songs to ${cleanTitle}`;
            }
            
            // Search YouTube for the AI's suggestion
            const results = await this.search(`${aiSuggestion} official audio`, 5);
            
            // 1. Filter out videos that we have already played in this session
            const unplayed = results.filter(r => {
                const vidId = this.extractVideoId(r.url);
                return vidId && !history.has(vidId);
            });

            // 2. Filter out highly similar titles (safety net just in case the AI ignored instructions)
            const tokenize = (str) => str.toLowerCase().replace(/[^\w\s]/gi, '').split(/\s+/).slice(0, 3).join(' ');
            const baseTokens = tokenize(lastTrack.title);

            const distinctUnplayed = unplayed.filter(r => {
                const rTokens = tokenize(r.title);
                return rTokens !== baseTokens; 
            });

            // Fallback chain: best distinct unplayed -> any unplayed -> first result
            if (distinctUnplayed.length > 0) return distinctUnplayed[0];
            if (unplayed.length > 0) return unplayed[0];
            return results.length > 0 ? results[0] : null;
        } catch (err) {
            logger.warn(`Failed to get recommendation for ${lastTrack.title}: ${err.message}`);
            return null;
        }
    }

    /**
     * Helper to extract video ID from various YouTube URL formats.
     */
    extractVideoId(url) {
        const patterns = [
            /[?&]v=([a-zA-Z0-9_-]{11})/,
            /youtu\.be\/([a-zA-Z0-9_-]{11})/,
            /\/shorts\/([a-zA-Z0-9_-]{11})/,
        ];
        for (const p of patterns) {
            const m = url.match(p);
            if (m) return m[1];
        }
        return null;
    }

    /**
     * Detect if a string is a YouTube URL.
     */
    isYouTubeURL(str) {
        return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(str);
    }

    /**
     * Detect if a YouTube URL is a playlist.
     */
    isPlaylistURL(str) {
        return /[?&]list=/i.test(str);
    }

    _parseISO8601Duration(iso) {
        if (!iso) return null;
        const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (!m) return null;
        return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
    }
}

// Singleton
module.exports = new YouTubeMetadata();
