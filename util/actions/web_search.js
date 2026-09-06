const axios = require('axios')
const wiki = require('wikipedia')
const { fetchPageText, extractUrls } = require('../summarize')
const { queryOllama } = require('../ollama')
const logger = require('../../logger')

/**
 * Secondary fallback to Google Search Grounding (Gemini API v1beta) when local URL/Wiki data is insufficient.
 */
async function searchViaGoogleGrounding (query) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash'
  try {
    logger.info(`web_search: Attempting Google Search Grounding fallback via ${model}...`)
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [{ text: `Search the web for real-time information: ${query}\nProvide a factual breakdown and include specific details, dates, and sources.` }] }],
        tools: [{ googleSearch: {} }]
      },
      { timeout: 15000 }
    )

    const candidate = res.data.candidates?.[0]
    const text = candidate?.content?.parts?.[0]?.text
    if (text && text.trim().length > 0) {
      const chunks = candidate.groundingMetadata?.groundingChunks || []
      const sources = chunks
        .filter(c => c.web?.uri)
        .map(c => `- [${c.web.title || 'Source'}](${c.web.uri})`)
        .slice(0, 5)

      let result = text
      if (sources.length > 0) {
        result += '\n\n**Sources:**\n' + sources.join('\n')
      }
      logger.info(`web_search: Successfully retrieved grounded results via ${model}`)
      return result
    }
  } catch (err) {
    logger.info(`web_search: Google Grounding fallback skipped: ${err.message}`)
  }
  return null
}

module.exports = {
  name: 'web_search',
  description: 'Fetches and extracts information from web pages, URLs, and encyclopedic reference data using local AI distillation.',
  schema: {
    query: 'The search query or target URL to investigate.'
  },
  execute: async (bot, channel, params, context) => {
    const query = params.query || params.message || params.url || ''
    if (!query) return '[SYSTEM: Error - No search query or URL provided.]'

    logger.info(`Action: web_search executing for: "${query}"`)

    const extractedUrls = extractUrls(query)
    const contentSources = []

    // 1. Direct Page Fetching for any explicit URLs
    if (extractedUrls.length > 0) {
      for (const url of extractedUrls.slice(0, 3)) {
        try {
          logger.info(`web_search: Fetching page directly: ${url}`)
          const pageText = await fetchPageText(url, 12000)
          if (pageText && pageText.length > 100) {
            contentSources.push({
              source: url,
              content: pageText.substring(0, 8000)
            })
          }
        } catch (fetchErr) {
          logger.warn(`web_search: Failed to fetch ${url}: ${fetchErr.message}`)
        }
      }
    }

    // 2. Live Web Search via Headless Browser (DuckDuckGo HTML)
    if (contentSources.length === 0) {
      try {
        const puppeteerSearch = require('../puppeteerSearch')
        logger.info(`web_search: Launching headless browser search for "${query}"...`)
        const searchResults = await puppeteerSearch.performSearch(query)
        if (searchResults && searchResults.length > 0) {
          for (const item of searchResults.slice(0, 5)) {
            contentSources.push({
              source: `Web Result: ${item.title} (${item.link})`,
              content: item.snippet
            })
          }

          // Fetch full page text for the top 2 links in parallel
          const pagePromises = searchResults.slice(0, 2).map(async (item) => {
            try {
              if (item.link && item.link.startsWith('http')) {
                const text = await fetchPageText(item.link, 10000)
                if (text && text.length > 200) {
                  return {
                    source: `Article: ${item.title} (${item.link})`,
                    content: text.substring(0, 5000)
                  }
                }
              }
            } catch (e) {}
            return null
          })

          const fetchedPages = await Promise.all(pagePromises)
          fetchedPages.filter(Boolean).forEach(p => contentSources.push(p))
        }
      } catch (pupErr) {
        logger.info(`web_search: Headless browser search skipped: ${pupErr.message}`)
      }
    }

    // 3. Wikipedia Search & Summary Reference
    try {
      const cleanSearchTerm = query.replace(/https?:\/\/[^\s]+/gi, '').trim()
      if (cleanSearchTerm.length > 2) {
        const searchRes = await wiki.search(cleanSearchTerm, { limit: 2 }).catch(() => null)
        if (searchRes && searchRes.results && searchRes.results.length > 0) {
          for (const item of searchRes.results.slice(0, 2)) {
            try {
              const page = await wiki.summary(item.title).catch(() => null)
              if (page && page.extract) {
                contentSources.push({
                  source: `Wikipedia: ${page.title} (${page.content_urls?.desktop?.page || item.title})`,
                  content: page.extract
                })
              }
            } catch (e) {}
          }
        }
      }
    } catch (wikiErr) {
      logger.info(`web_search: Wikipedia lookup skipped: ${wikiErr.message}`)
    }

    // 4. Fallback to Google Grounding if local sources were insufficient
    if (contentSources.length === 0) {
      const grounded = await searchViaGoogleGrounding(query)
      if (grounded) {
        return `[SYSTEM: WEB SEARCH RESULTS (Google Grounding)]\n${grounded}\n\n[INSTRUCTIONS]: Use this real-time information to formulate your answer.`
      }

      return `[SYSTEM: WEB RESEARCH FINDINGS FOR "${query}"]\nNo direct external web pages or articles were retrieved. Rely on deep internal model reasoning to answer the query thoroughly.`
    }

    // 3. Local Model (5090 RTX / Qwen) Context Distillation & Fact Extraction
    const combinedRaw = contentSources.map(s => `[SOURCE: ${s.source}]\n${s.content}`).join('\n\n---\n\n')

    try {
      logger.info(`web_search: Distilling ${contentSources.length} sources via local model on 5090...`)
      const distillationPrompt = `Extract the key technical facts, dates, specifications, and details relevant to the query: "${query}" from the retrieved raw sources below.\n\n` +
        `Raw Sources:\n${combinedRaw.substring(0, 10000)}\n\n` +
        'Respond with a concise, factual bulleted summary citing the relevant sources. Do not include conversational filler.'

      const distillRes = await queryOllama('/api/generate', {
        prompt: distillationPrompt,
        options: {
          num_predict: 800,
          temperature: 0.2
        }
      })

      const distilledText = (distillRes?.response || distillRes?.message?.content || '').trim()
      if (distilledText && distilledText.length > 50) {
        return `[SYSTEM: WEB SEARCH RESULTS (Distilled Knowledge)]\n${distilledText}\n\n[INSTRUCTIONS]: Use this real-time distilled information to formulate your answer.`
      }
    } catch (distillErr) {
      logger.warn(`web_search: Local distillation failed: ${distillErr.message}; using raw extracts`)
    }

    // Fallback: Return raw excerpts directly
    return `[SYSTEM: WEB SEARCH RESULTS (Raw Extracts)]\n${combinedRaw.substring(0, 4000)}\n\n[INSTRUCTIONS]: Use this real-time information to formulate your answer.`
  },
  searchViaGoogleGrounding
}
