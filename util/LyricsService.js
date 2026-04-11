const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

// Cache directory for lyrics
const CACHE_DIR = path.join(__dirname, '..', '.lyrics_cache');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Service to fetch song lyrics from public sources.
 * Implementation: Direct API Discovery with Multi-Scraper Fallback.
 * Features: Caching to avoid repeated API calls
 */
class LyricsService {
    constructor() {
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
        this.cache = new Map(); // In-memory cache for fast access
    }

    /**
     * Get cache file path for a given song
     */
    getCachePath(title, artist) {
        const key = `${this.normalizeKey(title)}-${this.normalizeKey(artist)}`;
        return path.join(CACHE_DIR, `${key}.json`);
    }

    /**
     * Normalize key for cache file naming
     */
    normalizeKey(str) {
        return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    /**
     * Check if cached lyrics are still valid
     */
    isCacheValid(cacheFile) {
        try {
            const stats = fs.statSync(cacheFile);
            const now = Date.now();
            return (now - stats.mtimeMs) < CACHE_TTL;
        } catch {
            return false;
        }
    }

    /**
     * Get lyrics from cache
     */
    getCachedLyrics(title, artist) {
        const cacheFile = this.getCachePath(title, artist);
        
        // Check in-memory cache first
        const cacheKey = `${title}-${artist}`;
        if (this.cache.has(cacheKey)) {
            logger.debug(`LyricsService: Cache hit (in-memory) for ${title} by ${artist}`);
            return this.cache.get(cacheKey);
        }

        // Check file cache
        if (fs.existsSync(cacheFile) && this.isCacheValid(cacheFile)) {
            try {
                const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                logger.debug(`LyricsService: Cache hit (file) for ${title} by ${artist}`);
                // Update in-memory cache
                this.cache.set(cacheKey, cached.lyrics);
                return cached.lyrics;
            } catch (err) {
                logger.warn(`LyricsService: Failed to read cache file: ${err.message}`);
            }
        }
        
        return null;
    }

    /**
     * Save lyrics to cache
     */
    saveToCache(title, artist, lyrics) {
        const cacheFile = this.getCachePath(title, artist);
        const cacheKey = `${title}-${artist}`;
        
        try {
            const data = {
                lyrics,
                timestamp: Date.now(),
                ttl: CACHE_TTL
            };
            fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8');
            this.cache.set(cacheKey, lyrics);
            logger.debug(`LyricsService: Saved to cache for ${title} by ${artist}`);
        } catch (err) {
            logger.warn(`LyricsService: Failed to save to cache: ${err.message}`);
        }
    }

    /**
     * Clear cache for a specific song or all cache
     */
    clearCache(title, artist) {
        if (title && artist) {
            const cacheFile = this.getCachePath(title, artist);
            if (fs.existsSync(cacheFile)) {
                fs.unlinkSync(cacheFile);
                logger.info(`LyricsService: Cleared cache for ${title} by ${artist}`);
            }
        } else {
            // Clear all cache
            try {
                if (fs.existsSync(CACHE_DIR)) {
                    fs.readdirSync(CACHE_DIR).forEach(file => {
                        fs.unlinkSync(path.join(CACHE_DIR, file));
                    });
                    logger.info('LyricsService: Cleared all cache files');
                }
            } catch (err) {
                logger.warn(`LyricsService: Failed to clear cache: ${err.message}`);
            }
        }
        // Clear in-memory cache
        this.cache.clear();
    }

    /**
     * Fetch lyrics for a given track title and channel/artist.
     * @param {string} title
     * @param {string} artist
     * @returns {Promise<string|null>}
     */
    async fetchLyrics(title, artist) {
        if (!title) return null;

        // Priority 0: Check cache first (fastest path)
        const cachedLyrics = this.getCachedLyrics(title, artist);
        if (cachedLyrics) return cachedLyrics;

        // Clean query: Remove common YouTube clutter and specific punctuation
        const cleanTitle = title.replace(/\(.*?\)|\[.*?\]/g, '').replace(/[!?]/g, '').trim();
        
        // Try with Artist first, then Title Only fallback
        const queries = [
            `${cleanTitle} ${artist || ''}`.trim(),
            cleanTitle
        ];

        for (const query of queries) {
            try {
                // Priority 1: Direct Genius Search API
                let lyrics = await this.discoveryviaGeniusAPI(query);
                if (lyrics) {
                    // Cache the lyrics before returning
                    this.saveToCache(title, artist, lyrics);
                    return lyrics;
                }

                // Priority 2: AnimeSongLyrics (Specialized fallback for Anime)
                const animeUrl = await this.findUrlViaGoogle(query, 'animesonglyrics.com');
                if (animeUrl) {
                    lyrics = await this.extractFromAnimeSongLyrics(animeUrl);
                    if (lyrics) {
                        this.saveToCache(title, artist, lyrics);
                        return lyrics;
                    }
                }

                // Priority 3: Google Search Scraper (Backup Discovery for Genius)
                const geniusUrl = await this.findUrlViaGoogle(query, 'genius.com');
                if (geniusUrl) {
                    lyrics = await this.extractFromGenius(geniusUrl);
                    if (lyrics) {
                        this.saveToCache(title, artist, lyrics);
                        return lyrics;
                    }
                }

                // Priority 4: AZLyrics Fallback
                const azUrl = await this.findUrlViaGoogle(query, 'azlyrics.com');
                if (azUrl) {
                    lyrics = await this.extractFromAZLyrics(azUrl);
                    if (lyrics) {
                        this.saveToCache(title, artist, lyrics);
                        return lyrics;
                    }
                }
            } catch (err) {
                logger.warn(`LyricsService: Sub-query attempt failed for "${query}": ${err.message}`);
                continue;
            }
        }

        logger.warn(`LyricsService: All sources failed for "${cleanTitle}"`);
        return null;
    }

    /**
     * Use Genius's internal search API for reliable discovery.
     */
    async discoveryviaGeniusAPI(query) {
        try {
            const searchUrl = `https://genius.com/api/search/multi?q=${encodeURIComponent(query)}`;
            const response = await axios.get(searchUrl, {
                headers: { 'User-Agent': this.userAgent, 'Accept': 'application/json' }
            });

            const sections = response.data?.response?.sections || [];
            const topHit = sections.find(s => s.type === 'top_hit')?.hits?.[0]?.result;
            const songHit = sections.find(s => s.type === 'song')?.hits?.[0]?.result;

            const bestHit = topHit?.url?.includes('/lyrics') ? topHit : songHit;
            
            if (bestHit && bestHit.url) {
                logger.info(`LyricsService: Found Genius API hit: ${bestHit.full_title}`);
                return await this.extractFromGenius(bestHit.url);
            }
            return null;
        } catch (err) {
            logger.warn(`LyricsService: Genius API search failed: ${err.message}`);
            return null;
        }
    }

    /**
     * Fallback: Search Google to find a specific website's URL.
     */
    async findUrlViaGoogle(query, domain) {
        try {
            // Try DuckDuckGo first (Lite)
            let searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(`${query} site:${domain}`)}`;
            let response = await axios.get(searchUrl, { headers: { 'User-Agent': this.userAgent } });
            let html = response.data;

            // If DDG fails (e.g. detected), try Bing (very lenient with scraper headers)
            if (!html.includes(domain)) {
                searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(`${query} site:${domain}`)}`;
                response = await axios.get(searchUrl, { headers: { 'User-Agent': this.userAgent } });
                html = response.data;
            }

            const regex = new RegExp(`https://${domain.replace(/\./g, '\\.')}/[^"\\s<>]{5,100}`, 'g');
            const matches = html.match(regex);
            
            if (matches && matches.length > 0) {
                return matches[0].split(/[">]/)[0];
            }

            return null;
        } catch (err) {
            return null;
        }
    }

    /**
     * Extract lyrics from Genius.com.
     */
    async extractFromGenius(url) {
        try {
            const response = await axios.get(url, { headers: { 'User-Agent': this.userAgent } });
            const $ = cheerio.load(response.data);
            
            let lyrics = '';
            
            // Container 1: Modern dynamic layout
            $('[data-lyrics-container="true"]').each((i, el) => {
                $(el).find('br').replaceWith('\n');
                lyrics += $(el).text() + '\n\n';
            });

            // Container 2: Legacy layout
            if (!lyrics.trim()) {
                lyrics = $('.lyrics').text();
            }

            return await this.sanitizeLyrics(lyrics);
        } catch (err) {
            return null;
        }
    }

    /**
     * Extract lyrics from AZLyrics.com.
     */
    async extractFromAZLyrics(url) {
        try {
            const response = await axios.get(url, { headers: { 'User-Agent': this.userAgent } });
            const $ = cheerio.load(response.data);
            
            // AZLyrics puts lyrics in a div with no class/id, usually preceded by a certain comment
            let lyrics = '';
            $('div.col-xs-12.col-lg-8 div').each((i, el) => {
                const text = $(el).text().trim();
                // Check if this looks like the lyrics block (long text, no class)
                if (text.length > 100 && !$(el).attr('class') && !$(el).attr('id')) {
                    lyrics = $(el).html().replace(/<br>/g, '\n').replace(/<[^>]*>/g, '').trim();
                }
            });

            return await this.sanitizeLyrics(lyrics);
        } catch (err) {
            return null;
        }
    }

    /**
     * Extract lyrics from AnimeSongLyrics.com (Romaji focus).
     */
    async extractFromAnimeSongLyrics(url) {
        try {
            const response = await axios.get(url, { headers: { 'User-Agent': this.userAgent } });
            const $ = cheerio.load(response.data);
            
            // Prefer Romaji column if it exists, otherwise the main lyrics body
            let lyrics = $('.romaji').text();
            if (!lyrics.trim()) {
                lyrics = $('#lyrics-body').text();
            }
            if (!lyrics.trim()) {
                lyrics = $('.lyrics').text();
            }

            return await this.sanitizeLyrics(lyrics);
        } catch (err) {
            return null;
        }
    }

    /**
     * Clean up formatting and remove technical tags.
     */
    async sanitizeLyrics(text) {
        if (!text || !text.trim()) return null;

        // Stage 1: Fast Regex Pre-Filter (Genius Specific Metadata)
        let cleaned = text
            .replace(/\d+\s+Contributors.*?Lyrics/is, '') // Strip "XX Contributors... Lyrics" header
            .replace(/\[(?:Chorus|Verse|Pre-Chorus|Bridge|Outro|Intro|Hook)\]/gi, '') // Remove specific metadata brackets only
            .replace(/\n{3,}/g, '\n\n') // Normalize repeats
            .replace(/^\n+|\n+$/g, '') 
            .trim();

        // Stage 2: AI Refinement Pass (Deep Clean)
        try {
            const aiCleaned = await this.cleanLyricsWithAI(cleaned);
            if (aiCleaned && aiCleaned.length > 50) {
                cleaned = aiCleaned;
            }
        } catch (err) {
            logger.warn(`LyricsService: AI cleaning failed, using regex fallback: ${err.message}`);
        }

        return cleaned;
    }

    /**
     * Use Gemini (via ollama.js) to strip metadata and return pure lyrics.
     */
    async cleanLyricsWithAI(text) {
        try {
            const { queryOllama } = require('./ollama');
            
            const prompt = `Below is a raw scrape of song lyrics which may contain metadata, contributor notes, website jargon (like "Read More"), or descriptions.

CLEANING RULES:
1. Return ONLY the actual song lyrics.
2. Strip all platform metadata, contributor credits, and song descriptions (the "About" or "Background" text).
3. If you see text about the song's meaning, history, or band trivia, DISCARD IT.
4. Preserve the structure of the verses and choruses.
5. Do NOT include any introductory or concluding remarks.
6. If the text appears to be entirely metadata/description with no lyrics, return an empty string.

RAW TEXT:
${text.substring(0, 5000)}`;

            const result = await queryOllama('/api/generate', { prompt }, 1); // Level 1: Gemini
            return result?.response?.trim() || null;
        } catch (err) {
            logger.warn(`LyricsService: AI cleaning failed: ${err.message}`);
            return text; // Return regex-cleaned text as fallback
        }
    }
}

module.exports = new LyricsService();
