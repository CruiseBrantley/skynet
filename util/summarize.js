const axios = require('axios');
const play = require('play-dl');
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

const SUCCINCT_PROMPT = `Given the text content of a web page, provide an extremely brief, one-sentence summary.
Focus ONLY on the single most important takeaway or the "bottom line". 
Use Discord markdown formatting, but NEVER use markdown link syntax like [text](url).
DO NOT repeat the source URL. 
If the page is a login/captcha or has no substantive content, reply with "SKIP".`;

const LONG_PROMPT = `Given the text content of a web page, provide a detailed but concise summary.
Focus on the SPECIFIC details, changes, or facts — not generic descriptions of what the page is about. 
For patch notes or changelogs, list the most important individual changes as bullet points. 
For news articles, highlight the key facts and findings.
Avoid vague statements like "the update includes fixes" — instead say what was fixed. 
Use Discord markdown formatting, but NEVER use markdown link syntax like [text](url).
DO NOT repeat the source URL. 
If the page is a login/captcha or has no substantive content, reply with "SKIP".`;

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
            const info = await play.video_basic_info(url);
            if (info && info.video_details) {
                const desc = info.video_details.description || '';

                let transcriptText = "";
                try {
                    const match = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/);
                    const videoId = match ? match[1] : null;
                    if (videoId && typeof url === 'string') {
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

                return `YouTube Video Title: ${info.video_details.title}\n\nDescription:\n${desc}${transcriptText}`;
            }
        } catch (err) {
            logger.info(`Failed to fetch YouTube info for ${url}: ${err.message}`);
            return null;
        }
    }

    try {
        const response = await axios.get(url, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Referer': 'https://www.google.com/'
            },
            maxRedirects: 5
        });

        const html = response.data;
        if (typeof html !== 'string') return null;

        // Strip junk tags to get raw content
        let text = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[\s\S]*?<\/header>/gi, '')
            .replace(/<aside[\s\S]*?<\/aside>/gi, '')
            .replace(/<form[\s\S]*?<\/form>/gi, '')
            .replace(/<svg[\s\S]*?<\/svg>/gi, '')
            .replace(/<canvas[\s\S]*?<\/canvas>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&[a-z]+;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (text.length < 100) {
            logger.info(`Fetched very little text (${text.length} chars) from ${url}. Page may be dynamic/JS-heavy.`);
        } else {
            logger.info(`Fetched ${text.length} characters from ${url}`);
        }

        // Limit to first ~6000 chars to avoid massive payloads
        return text.substring(0, 6000);
    } catch (err) {
        logger.info(`Failed to fetch page ${url}: ${err.message}`);
        return null;
    }
}

async function summarizeUrl(url, isLong = false) {
    const pageText = await fetchPageText(url);
    if (!pageText || pageText.length < 100) {
        return null;
    }

    const systemPrompt = isLong ? LONG_PROMPT : SUCCINCT_PROMPT;

    const result = await queryOllama('/api/chat', {
        messages: [
            {
                role: 'system',
                content: systemPrompt
            },
            {
                role: 'user',
                content: `Summarize this web page:\n\nURL: ${url}\n\nPage content:\n${pageText}`
            }
        ]
    });

    if (result && result.message && result.message.content) {
        let content = result.message.content.trim();
        if (content === 'SKIP' || content === '"SKIP"' || content.toLowerCase().includes("i cannot summarize")) {
            return null;
        }

        // Final safety check to strip the URL if the AI included it anyway
        const lowerContent = content.toLowerCase();
        const lowerUrl = url.toLowerCase();
        if (lowerContent.endsWith(lowerUrl)) {
            content = content.substring(0, content.length - url.length).trim();
        } else if (lowerContent.endsWith(`<${lowerUrl}>`)) {
            content = content.substring(0, content.length - (url.length + 2)).trim();
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
