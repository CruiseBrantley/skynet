jest.mock("../logger")
jest.mock("../util/ollama")
jest.mock("../util/puppeteerSearch")
jest.mock("wikipedia")
jest.mock("axios")

const webSearch = require("../util/actions/web_search")
const { queryOllama } = require("../util/ollama")
const puppeteerSearch = require("../util/puppeteerSearch")
const wiki = require("wikipedia")
const axios = require("axios")

describe("actions/web_search", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GEMINI_API_KEY = "test-key"
    process.env.GEMINI_MODEL = "gemini-3.7-flash"
  })

  test("runs Puppeteer live search, scrapes top pages, and distills with 5090 model", async () => {
    puppeteerSearch.performSearch.mockResolvedValue([
      { title: "Top Anime Summer 2026", snippet: "Top anime include Frieren S2 and Solo Leveling S2.", link: "https://anime.com/top" },
      { title: "Crunchyroll Season Lineup", snippet: "Crunchyroll announces summer anime streaming lineup.", link: "https://crunchyroll.com/summer" }
    ])
    axios.get.mockResolvedValue({
      data: "<html><body><article><p>Detailed anime guide: Frieren S2 airs on Fridays. Solo Leveling S2 streams on Crunchyroll.</p></article></body></html>"
    })
    queryOllama.mockResolvedValue({
      response: "1. Frieren Season 2 - Top rated summer 2026 anime\n2. Solo Leveling Season 2 - Most streamed on Crunchyroll"
    })

    const result = await webSearch.execute(null, null, {
      query: "Most popular anime streaming this season"
    })

    expect(puppeteerSearch.performSearch).toHaveBeenCalledWith("Most popular anime streaming this season")
    expect(queryOllama).toHaveBeenCalledWith("/api/generate", expect.objectContaining({
      prompt: expect.stringContaining("Top anime include")
    }))
    expect(result).toContain("Distilled Knowledge")
    expect(result).toContain("Frieren")
  })

  test("falls back to Google Grounding if Puppeteer and Wikipedia return no results", async () => {
    puppeteerSearch.performSearch.mockResolvedValue([])
    wiki.search.mockResolvedValue({ results: [] })
    axios.post.mockResolvedValue({
      data: {
        candidates: [{
          content: { parts: [{ text: "Live weather in Dallas is 82°F and sunny." }] },
          groundingMetadata: {
            groundingChunks: [{ web: { uri: "https://weather.com", title: "The Weather Channel" } }]
          }
        }]
      }
    })

    const result = await webSearch.execute(null, null, {
      query: "weather Dallas TX today"
    })

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("gemini-3.7-flash"),
      expect.anything(),
      expect.anything()
    )
    expect(result).toContain("Google Grounding")
    expect(result).toContain("82°F")
  })
})
