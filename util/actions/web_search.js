const axios = require('axios')
const wiki = require('wikipedia')
const puppeteerSearch = require('../puppeteerSearch')
const { fetchPageText } = require('../summarize')
const logger = require('../../logger')

/**
 * Searches the web via Google Search Grounding (Gemini API v1beta).
 * Falls back across candidate models if one experiences transient demand spikes.
 */
async function searchViaGoogleGrounding (query) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const candidateModels = ['gemini-2.5-flash', 'gemini-3.7-flash', 'gemini-3.5-flash']
  for (const model of candidateModels) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        logger.info(`web_search: Attempting Google Search Grounding via ${model} (attempt ${attempt})...`)
        const res = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            contents: [{ parts: [{ text: `Search the web for real-time information: ${query}\nProvide a factual breakdown and include specific details, dates, and sources.` }] }],
            tools: [{ googleSearch: {} }]
          },
          { timeout: 60000 }
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
        const status = err.response?.status
        logger.warn(`web_search: Google Search Grounding via ${model} (attempt ${attempt}) failed (HTTP ${status || 'ERR'}): ${err.message}`)
        if (status === 503 && attempt === 1) {
          // Transient demand spike on Google servers; wait 1.5s and retry
          await new Promise(resolve => setTimeout(resolve, 1500))
          continue
        }
        if (status && status !== 503 && status !== 429 && status !== 404 && status !== 500) {
          break
        }
      }
    }
  }
  return null
}

module.exports = {
  name: 'web_search',
  description: 'Searches the web for real-time information, specific facts, domain reputation, news corroboration, or fact-checking.',
  schema: {
    query: 'The search query to perform.'
  },
  execute: async (bot, channel, params, context) => {
    const query = params.query || params.message || ''
    if (!query) return '[SYSTEM: Error - No search query provided.]'

    logger.info(`Action: web_search executing for query: "${query}"`)

    try {
      // Tier 1: Google Search Grounding via Gemini API
      const groundedResult = await searchViaGoogleGrounding(query)
      if (groundedResult) {
        return `[SYSTEM: WEB SEARCH RESULTS (Google Grounding)]\n${groundedResult}\n\n[INSTRUCTIONS]: Use this real-time information to answer the user accurately.`
      }

      // Tier 2: Wikipedia Summary
      let results = []
      try {
        const wikiSummary = await wiki.summary(query)
        if (wikiSummary && wikiSummary.extract) {
          results = [{
            title: wikiSummary.title,
            snippet: wikiSummary.extract,
            link: wikiSummary.content_urls.desktop.page
          }]
        }
      } catch (wikiErr) {
        logger.info(`Wikipedia fallback failed: ${wikiErr.message}`)
      }

      // Tier 3: Puppeteer Headless Browser
      if (!results || results.length === 0) {
        try {
          logger.info(`Action: Spinning up headless Chromium for "${query}"...`)
          results = await puppeteerSearch.performSearch(query)
        } catch (pupErr) {
          logger.error(`Puppeteer crawler failed: ${pupErr.message}`)
        }
      }

      if (!results || results.length === 0) {
        return `[SYSTEM: WEB SEARCH RETURNED NO RESULTS FOR "${query}". Use internal knowledge.]`
      }

      const searchResultsStr = results.slice(0, 5).map(r => `Title: ${r.title}\nSnippet: ${r.snippet || ''}\nLink: ${r.link}`).join('\n\n')

      // Deep Enrichment: Read top link
      const researchPromises = []
      const limit = results.length > 3 ? 3 : results.length

      for (let i = 0; i < limit; i++) {
        researchPromises.push((async () => {
          try {
            const rawText = await fetchPageText(results[i].link, 15000)
            if (rawText && rawText.length > 200) {
              return `[Source: ${results[i].title}]\n${rawText.substring(0, 3000)}`
            }
          } catch (e) {
            return null
          }
          return null
        })())
      }

      const pageContents = await Promise.all(researchPromises)
      const validContents = pageContents.filter(c => c !== null)

      let fullContent = ''
      if (validContents.length > 0) {
        fullContent = '\n\nDETAILED PAGE ANALYSES:\n' + validContents.join('\n\n---\n\n')
      }

      return `[SYSTEM: WEB SEARCH RESULTS]\n${searchResultsStr}${fullContent}\n\n[INSTRUCTIONS]: Use this information to answer the user. Mention sources if relevant.`
    } catch (err) {
      logger.error(`web_search action failed: ${err.message}`)
      return `[SYSTEM: Error performing web search: ${err.message}]`
    }
  },
  searchViaGoogleGrounding
}
