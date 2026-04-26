const googleIt = require('google-it')
const ddg = require('duck-duck-scrape')
const wiki = require('wikipedia')
const puppeteerSearch = require('../puppeteerSearch')
const { fetchPageText } = require('../summarize')
const logger = require('../../logger')

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
      let results = []
      // Tier 1: Google (via google-it)
      try {
        results = await googleIt({ query, disableConsole: true })
      } catch (err) {
        logger.info(`Google-it failed for "${query}", trying DuckDuckGo fallback.`)
      }

      // Tier 2: DuckDuckGo
      if (!results || results.length === 0) {
        try {
          const ddgResults = await ddg.search(query)
          if (ddgResults && ddgResults.results) {
            results = ddgResults.results.slice(0, 3).map(r => ({
              title: r.title,
              snippet: r.description,
              link: r.url
            }))
          }
        } catch (ddgErr) {
          logger.error(`DuckDuckGo fallback failed for "${query}": ${ddgErr.message}`)
        }
      }

      // Tier 3: Puppeteer (Full Browser)
      if (!results || results.length === 0) {
        try {
          logger.info(`Action: Spinning up headless Chromium for "${query}"...`)
          results = await puppeteerSearch.performSearch(query)
        } catch (pupErr) {
          logger.error(`Puppeteer crawler failed: ${pupErr.message}`)
        }
      }

      // Tier 4: Wikipedia
      if (!results || results.length === 0) {
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
      }

      if (!results || results.length === 0) {
        return `[SYSTEM: WEB SEARCH RETURNED NO RESULTS FOR "${query}". Use internal knowledge.]`
      }

      const searchResultsStr = results.slice(0, 5).map(r => `Title: ${r.title}\nSnippet: ${r.snippet || ''}\nLink: ${r.link}`).join('\n\n')

      // Deep Enrichment: Read top link
      // Perform scraping in parallel for speed
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
  }
}
