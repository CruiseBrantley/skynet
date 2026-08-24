const axios = require('axios')
const stateStore = require('../StateStore')
const logger = require('../../logger')

function stripHtml (html) {
  if (!html) return ''
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseFeed (xmlText, limit = 5) {
  const items = []
  const isAtom = xmlText.includes('<entry>') || xmlText.includes('<feed')

  if (isAtom) {
    const entryBlocks = xmlText.match(/<entry[\s\S]*?<\/entry>/gi) || []
    for (const block of entryBlocks.slice(0, limit)) {
      const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
      const linkMatch = block.match(/<link[^>]+href=["']([^"']+)["']/i) || block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)
      const updatedMatch = block.match(/<(?:updated|published)[^>]*>([\s\S]*?)<\/(?:updated|published)>/i)
      const idMatch = block.match(/<id[^>]*>([\s\S]*?)<\/id>/i)
      const summaryMatch = block.match(/<(?:summary|content)[^>]*>([\s\S]*?)<\/(?:summary|content)>/i)

      items.push({
        title: stripHtml(titleMatch ? titleMatch[1] : 'No Title'),
        link: linkMatch ? (linkMatch[1] || linkMatch[2] || '').trim() : '',
        pubDate: updatedMatch ? updatedMatch[1].trim() : '',
        id: idMatch ? idMatch[1].trim() : '',
        summary: stripHtml(summaryMatch ? summaryMatch[1] : '').substring(0, 300)
      })
    }
  } else {
    // RSS 2.0 / 0.9 / RDF
    const itemBlocks = xmlText.match(/<item[\s\S]*?<\/item>/gi) || []
    for (const block of itemBlocks.slice(0, limit)) {
      const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
      const linkMatch = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)
      const pubDateMatch = block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)
      const guidMatch = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)
      const descMatch = block.match(/<(?:description|content:encoded)[^>]*>([\s\S]*?)<\/(?:description|content:encoded)>/i)

      items.push({
        title: stripHtml(titleMatch ? titleMatch[1] : 'No Title'),
        link: linkMatch ? linkMatch[1].trim() : '',
        pubDate: pubDateMatch ? pubDateMatch[1].trim() : '',
        id: guidMatch ? guidMatch[1].trim() : '',
        summary: stripHtml(descMatch ? descMatch[1] : '').substring(0, 300)
      })
    }
  }

  return items
}

module.exports = {
  name: 'fetch_feed',
  description: 'Pulls an RSS or Atom XML feed (e.g. Steam news, Reddit, dev blogs, game patch notes), returning structured articles/items.',
  schema: {
    url: {
      type: 'string',
      description: 'The RSS or Atom feed URL (e.g. "https://store.steampowered.com/feeds/news/app/2089300/").'
    },
    limit: {
      type: 'integer',
      description: 'Number of recent items to retrieve (default: 5, max: 20).'
    },
    diff_key: {
      type: 'string',
      description: 'Optional StateStore key to check if the latest item has changed since last fetch.'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const url = (params.url || '').trim()
    if (!url) return '[SYSTEM: Error: "url" parameter is required for fetch_feed.]'

    const limit = Math.max(1, Math.min(20, parseInt(params.limit) || 5))

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Skynet-Feed-Ingester/1.0 (+https://github.com/CruiseBrantley/skynet)'
        },
        timeout: 8000
      })

      const xmlText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
      const items = parseFeed(xmlText, limit)

      if (items.length === 0) {
        return `[SYSTEM: Successfully fetched feed from ${url}, but found no RSS <item> or Atom <entry> elements.]`
      }

      let diffNotice = ''
      if (params.diff_key) {
        const latestId = items[0].id || items[0].link || items[0].title
        const diffRes = stateStore.diff(params.diff_key, latestId)
        diffNotice = `\n• **Baseline Diff (${params.diff_key})**: ${diffRes.hasChanged ? '🆕 NEW CONTENT DETECTED' : 'Unchanged (matches stored baseline)'}`
        if (diffRes.hasChanged) {
          stateStore.set(params.diff_key, latestId)
        }
      }

      let out = `📰 **Feed Articles (${items.length} Items from ${url})**:${diffNotice}\n\n`
      for (const item of items) {
        out += `• **[${item.title}](${item.link})**\n`
        if (item.pubDate) out += `  ↳ *Published*: ${item.pubDate}\n`
        if (item.summary) out += `  ↳ *Summary*: ${item.summary}\n`
      }

      return `[SYSTEM: RSS Feed Content:\n${out}]`
    } catch (err) {
      logger.error(`fetch_feed: Error fetching feed from ${url}: ${err.message}`)
      return `[SYSTEM: Failed to fetch RSS/Atom feed from ${url}: ${err.message}]`
    }
  }
}
