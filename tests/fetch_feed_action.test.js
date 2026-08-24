const axios = require('axios')
const fetchFeedAction = require('../util/actions/fetch_feed')

jest.mock('axios')

describe('fetch_feed Action', () => {
  test('parses RSS 2.0 feed and extracts items', async () => {
    const mockRssXml = `
      <rss version="2.0">
        <channel>
          <title>Steam News</title>
          <item>
            <title>Major Patch 1.5 Released</title>
            <link>https://steamcommunity.com/news/123</link>
            <pubDate>Mon, 24 Aug 2026 00:00:00 GMT</pubDate>
            <description>Exciting new patch notes with balance changes.</description>
          </item>
        </channel>
      </rss>
    `

    axios.get.mockResolvedValueOnce({ data: mockRssXml })

    const res = await fetchFeedAction.execute({}, {}, { url: 'https://example.com/rss.xml', limit: 5 })
    expect(res).toContain('Feed Articles')
    expect(res).toContain('Major Patch 1.5 Released')
    expect(res).toContain('https://steamcommunity.com/news/123')
    expect(res).toContain('Exciting new patch notes')
  })

  test('parses Atom feed and extracts entries', async () => {
    const mockAtomXml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Dev Blog</title>
        <entry>
          <title>Developer Update #42</title>
          <link href="https://devblog.com/42" />
          <updated>2026-08-24T01:00:00Z</updated>
          <summary>New roadmaps for end-game progression.</summary>
        </entry>
      </feed>
    `

    axios.get.mockResolvedValueOnce({ data: mockAtomXml })

    const res = await fetchFeedAction.execute({}, {}, { url: 'https://example.com/atom.xml' })
    expect(res).toContain('Developer Update #42')
    expect(res).toContain('https://devblog.com/42')
    expect(res).toContain('New roadmaps')
  })
})
