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
        // Protect durationSeconds from being overwritten by null/undefined if we already have it
        const existing = this.cache.get(videoId);
        if (existing && existing.durationSeconds && !info.durationSeconds) {
            info.durationSeconds = existing.durationSeconds;
        }

        this.cache.set(videoId, info);
        this._saveCache();
    }

    /**
     * Utility to select the best available thumbnail or upgrade to HD.
     */
    _getBestThumbnail(thumbnails) {
        if (!thumbnails) return null;
        
        // Priority waterfall: maxres -> standard -> high -> medium -> default
        const url = thumbnails.maxres?.url 
                 || thumbnails.standard?.url 
                 || thumbnails.high?.url 
                 || thumbnails.medium?.url 
                 || thumbnails.default?.url;

        if (!url) return null;

        // If we only have medium, low, or numbered frames (0.jpg-3.jpg) from a search result, try to force-upgrade to hqdefault.
        // hqdefault.jpg exists for almost every video ever uploaded to YouTube and is safe.
        // maxresdefault.jpg (1080p) is only available for newer/high-res videos and often 404s on older content.
        if (url.includes('ytimg.com') && !url.includes('maxresdefault') && !url.includes('hqdefault') && !url.includes('sddefault')) {
            // Replace the low-res filename with the safe hqdefault bypass
            return url.replace(/\/(default|mqdefault|[0-3])\.jpg(\?.*)?$/, '/hqdefault.jpg');
        }

        return url;
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
                    thumbnail: this._getBestThumbnail(r.thumbnails),
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
                    thumbnail: this._getBestThumbnail({
                        default: { url: item.thumbnail },
                        high: { url: item.bestThumbnail?.url }
                    }),
                }))
            };
        } catch (err) {
            // Fallback for Mixes or other unsupported dynamic playlists using yt-dlp
            logger.warn(`Could not expand playlist ${url} with ytpl, falling back to yt-dlp: ${err.message}`);
            
            try {
                const { execFile } = require('child_process');
                const { YT_DLP } = require('./paths');
                
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
                            url: item.url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : null),
                            title: item.title,
                            channel: item.uploader || item.channel || 'Unknown',
                        thumbnail: this._getBestThumbnail({
                            default: { url: item.thumbnail },
                            high: { url: item.thumbnails?.[0]?.url }
                        }),
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
                thumbnail: this._getBestThumbnail(item.snippet.thumbnails),
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
    async getRecommendation(historyTracks, sessionHistory = new Set()) {
        if (!historyTracks || historyTracks.length === 0) return null;
        
        const currentTrack = historyTracks[historyTracks.length - 1];
        const pastTracks = historyTracks.slice(0, -1);
        
        try {
            const { queryOllama } = require('./ollama');
            
            // Format history for the prompt
            const historyList = pastTracks.map(t => ` - ${t.title} (${t.channel})`).join('\n');
            const currentDesc = `${currentTrack.title} (${currentTrack.channel})`;

            const seed = Math.floor(Math.random() * 1000000);
            logger.info(`Getting AI recommendation based on history of ${historyTracks.length} tracks (Current: ${currentTrack.title})...`);
            
            const prompt = `You are an expert DJ AI. 
The user recently listened to:
${historyList || " (No previous history)"}

They are NOW listening to:
 - ${currentDesc}

Recommend exactly ONE highly similar, great song by a DIFFERENT artist that fits the exact same mood, genre, and vibe as this sequence.
CRITICAL INSTRUCTION: The recommendation MUST be firmly within the exact same musical genre and vibe as the current song. To prevent loops, pick a different artist and a different track than any of those listed above.
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
                aiSuggestion = `related songs to ${currentTrack.title}`;
            }
            
            // Search YouTube for the AI's suggestion
            const results = await this.search(`${aiSuggestion} official audio`, 5);
            
            // 1. Filter out videos that we have already played in this session
            const unplayed = results.filter(r => {
                const vidId = this.extractVideoId(r.url);
                return vidId && !sessionHistory.has(vidId);
            });

            // 2. Filter out highly similar titles (safety net just in case the AI ignored instructions)
            const tokenize = (str) => str.toLowerCase().replace(/[^\w\s]/gi, '').split(/\s+/).slice(0, 3).join(' ');
            const baseTokens = tokenize(currentTrack.title);

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
