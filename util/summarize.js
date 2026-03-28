const axios = require('axios');
const ytdl = require('ytdl-core');
const { getSubtitles } = require('youtube-captions-scraper');
const logger = require('../logger');
const { queryOllama } = require('./ollama');

// Simple URL regex
const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

// Domains to skip (images, videos, Discord links, etc.)
const SKIP_PATTERNS = [
    /\.(png|jpg|jpeg|gif|webp|mp4|webm|mov|pdf)$/i,
    /discord\.(com|gg)/i,
    /twitch\.tv/i,
    /tenor\.com/i,
    /giphy\.com/i
];

function extractUrls(text) {
    if (!text) return [];
    return text.match(URL_REGEX) || [];
}

function shouldSkipUrl(url) {
    return SKIP_PATTERNS.some(pattern => pattern.test(url));
}

async function fetchPageText(url) {
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        try {
            const info = await ytdl.getBasicInfo(url);
            if (info && info.videoDetails) {
                const desc = info.videoDetails.description || '';
                
                let transcriptText = "";
                try {
                    const match = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/);
                    const videoId = match ? match[1] : null;
                    if (videoId) {
                        const captions = await getSubtitles({ videoID: videoId, lang: 'en' });
                        if (captions && captions.length > 0) {
                            transcriptText = "\n\nTranscript:\n" + captions.map(c => c.text).join(' ');
                            // Limit transcript size
                            transcriptText = transcriptText.substring(0, 10000);
                        }
                    }
                } catch (e) {
                    // Ignore transcript fetch errors
                }

                return `YouTube Video Title: ${info.videoDetails.title}\n\nDescription:\n${desc}${transcriptText}`;
            }
        } catch (err) {
            logger.info(`Failed to fetch YouTube info for ${url}: ${err.message}`);
            return null;
        }
    }

    try {
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; SkynetBot/1.0)',
                'Accept': 'text/html'
            },
            maxRedirects: 3
        });

        const html = response.data;
        if (typeof html !== 'string') return null;

        // Strip scripts, styles, and HTML tags to get raw text
        let text = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[\s\S]*?<\/header>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&[a-z]+;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // Limit to first ~6000 chars to avoid massive payloads
        return text.substring(0, 6000);
    } catch (err) {
        logger.info(`Failed to fetch page ${url}: ${err.message}`);
        return null;
    }
}

async function summarizeUrl(url) {
    const pageText = await fetchPageText(url);
    if (!pageText || pageText.length < 100) {
        return null;
    }

    const result = await queryOllama('/api/chat', {
        messages: [
            {
                role: 'system',
                content: 'You are a helpful summarizer. Given the text content of a web page, provide a detailed but concise summary. Focus on the SPECIFIC details, changes, or facts — not generic descriptions of what the page is about. For patch notes or changelogs, list the most important individual changes as bullet points. For news articles, highlight the key facts and findings. Avoid vague statements like "the update includes fixes" — instead say what was fixed. Use Discord markdown formatting, BUT NEVER USE markdown link syntax like `[text](url)` since Discord does not support it in standard messages. Just provide the raw URL. If the text has no substantive content (e.g. login page, captcha, access denied), DO NOT summarize it. Instead, reply with exactly the word "SKIP".'
            },
            {
                role: 'user',
                content: `Summarize this web page:\n\nURL: ${url}\n\nPage content:\n${pageText}`
            }
        ]
    });

    if (result && result.message && result.message.content) {
        const content = result.message.content.trim();
        if (content === 'SKIP' || content === '"SKIP"' || content.toLowerCase().includes("i cannot summarize")) {
            return null;
        }
        return content;
    }
    return null;
}

function splitMessage(text, limit = 1900) {
    if (!text) return [''];
    const chunks = [];
    let current = '';
    for (const line of text.split('\n')) {
        if (current.length + line.length + 1 > limit) {
            chunks.push(current);
            current = line + '\n';
        } else {
            current += line + '\n';
        }
    }
    if (current.trim().length > 0) chunks.push(current);
    if (chunks.length === 0) chunks.push(text.substring(0, limit));
    return chunks;
}

module.exports = { extractUrls, shouldSkipUrl, summarizeUrl, splitMessage, URL_REGEX };
