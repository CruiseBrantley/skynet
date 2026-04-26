const axios = require('axios')
const play = require('play-dl')
const { getSubtitles } = require('youtube-captions-scraper')
const logger = require('../logger')
const { queryOllama } = require('./ollama')

// Simple URL regex
const URL_REGEX = /https?:\/\/[^\s<>"']+/gi

// Domains to skip (images, videos, Discord links, etc.)
const SKIP_PATTERNS = [
  /\.(png|jpg|jpeg|gif|webp|mp4|webm|mov|pdf)$/i,
  /discord\.(com|gg)/i,
  /twitch\.tv/i,
  /tenor\.com/i,
  /giphy\.com/i
]

const SUCCINCT_PROMPT = `Given the text content of a web page, provide a very brief summary (maximum 2 sentences).
Focus ONLY on the most important core takeaway. 
DO NOT use bullet points, multiple paragraphs, or detailed breakdowns. 
Use Discord markdown formatting, but NEVER use markdown link syntax like [text](url).
DO NOT repeat the source URL. 
If the page is empty or a login, reply with "SKIP".`

const LONG_PROMPT = `Given the text content of a web page, provide a detailed but concise summary.
Focus on the SPECIFIC details, changes, or facts — not generic descriptions of what the page is about. 
For patch notes or changelogs, list the most important individual changes as bullet points. 
For news articles, highlight the key facts and findings.
Avoid vague statements like "the update includes fixes" — instead say what was fixed. 
Use Discord markdown formatting, but NEVER use markdown link syntax like [text](url).
DO NOT repeat the source URL. 
If the page is a login/captcha or has no substantive content, reply with "SKIP".`

function extractUrls (text) {
  if (!text) return []
  return text.match(URL_REGEX) || []
}

function shouldSkipUrl (url) {
  return SKIP_PATTERNS.some(pattern => pattern.test(url))
}

async function fetchPageText (url, limit = 6000) {
  if (typeof url !== 'string') return null

  let targetUrl = url
  if (targetUrl.startsWith('//')) {
    targetUrl = 'https:' + targetUrl
  }

  if (targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be')) {
    try {
      const info = await play.video_basic_info(targetUrl)
      if (info && info.video_details) {
        const desc = info.video_details.description || ''

        let transcriptText = ''
        try {
          const match = targetUrl.match(/[?&]v=([^&]+)/) || targetUrl.match(/youtu\.be\/([^?]+)/)
          const videoId = match ? match[1] : null
          if (videoId) {
            const captions = await getSubtitles({ videoID: videoId, lang: 'en' })
            if (captions && captions.length > 0) {
              transcriptText = '\n\nTranscript:\n' + captions.map(c => c.text).join(' ')
              transcriptText = transcriptText.substring(0, 10000)
            }
          }
        } catch (e) {}

        return `YouTube Video Title: ${info.video_details.title}\n\nDescription:\n${desc}${transcriptText}`
      }
    } catch (err) {
      logger.info(`Failed to fetch YouTube info for ${targetUrl}: ${err.message}`)
      return null
    }
  }

  try {
    const response = await axios.get(targetUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
      },
      maxRedirects: 5
    })

    const html = response.data
    return parseHtmlToText(html, targetUrl)
  } catch (err) {
    if (err.response?.status === 403 || err.response?.status === 401 || err.code === 'ECONNABORTED' || !err.response) {
      logger.info(`Axios failed for ${targetUrl}. Attempting Puppeteer...`)
      return await fetchViaPuppeteer(targetUrl, limit)
    }
    logger.info(`Failed to fetch page ${targetUrl}: ${err.message}`)
    return null
  }
}

async function fetchViaPuppeteer (url, limit = 6000) {
  const puppeteer = require('puppeteer')
  let browser
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    })
    const page = await browser.newPage()
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36')

    // Use a more generous timeout for Puppeteer
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Extract text from body, removing script/style tags
    const text = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script, style, nav, footer, header, aside, form, svg, canvas')
      scripts.forEach(s => s.remove())
      return document.body.innerText
    })

    const cleaned = text.replace(/\s+/g, ' ').trim()
    logger.info(`Puppeteer successfully fetched ${cleaned.length} characters from ${url}`)
    return cleaned.substring(0, limit)
  } catch (err) {
    logger.error(`Puppeteer fallback failed for ${url}: ${err.message}`)
    return null
  } finally {
    if (browser) await browser.close()
  }
}

function parseHtmlToText (html, url) {
  if (typeof html !== 'string') return null

  // Strip junk tags to get raw content
  const text = html
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
    .trim()

  if (text.length < 100) {
    logger.info(`Extracted very little text (${text.length} chars) from ${url}.`)
  }

  return text
}

async function summarizeUrl (url, isLong = false) {
  const pageText = await fetchPageText(url)
  if (!pageText || pageText.length < 100) {
    return null
  }

  const systemPrompt = isLong ? LONG_PROMPT : SUCCINCT_PROMPT

  logger.info(`Summarize: Sending ${pageText.length} chars to Ollama...`)
  const result = await queryOllama('/api/chat', {
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: `Summarize this web page content. If it is a LIVE NEWS feed, focus on the most recent major events.\n\nURL: ${url}\n\nPage content:\n${pageText}`
      }
    ],
    options: {
      num_predict: isLong ? 1024 : 150,
      temperature: 0.3
    }
  })

  if (result && result.message && result.message.content) {
    let content = result.message.content.trim()
    logger.info(`Summarize: AI Response: "${content.substring(0, 100)}..."`)

    if (content === 'SKIP' || content === '"SKIP"' || content.toLowerCase().includes('i cannot summarize')) {
      return null
    }

    // Final safety check to strip the URL if the AI included it anyway
    const lowerContent = content.toLowerCase()
    const lowerUrl = url.toLowerCase()
    if (lowerContent.endsWith(lowerUrl)) {
      content = content.substring(0, content.length - url.length).trim()
    } else if (lowerContent.endsWith(`<${lowerUrl}>`)) {
      content = content.substring(0, content.length - (url.length + 2)).trim()
    }

    return content
  }
  return null
}

function splitMessage (text, limit = 1900) {
  if (!text) return ['']
  const chunks = []
  let current = ''
  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > limit) {
      chunks.push(current)
      current = line + '\n'
    } else {
      current += line + '\n'
    }
  }
  if (current.trim().length > 0) chunks.push(current)
  if (chunks.length === 0) chunks.push(text.substring(0, limit))
  return chunks
}

module.exports = { extractUrls, shouldSkipUrl, summarizeUrl, splitMessage, URL_REGEX, fetchPageText }
