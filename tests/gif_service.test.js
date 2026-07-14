const axios = require('axios')
const gifService = require('../util/chat/gifService')

jest.mock('axios')
jest.mock('../logger')

let mockThemeValue = 'default'
jest.mock('../firebase-login', () => {
  return jest.fn().mockImplementation(() => {
    return {
      ref: jest.fn().mockReturnThis(),
      once: jest.fn().mockResolvedValue({
        val: () => mockThemeValue
      })
    }
  })
})

describe('GIF Lookup Service (gifService)', () => {
  const originalApiKey = process.env.GIPHY_API_KEY

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.GIPHY_API_KEY
    mockThemeValue = 'default'
  })

  afterAll(() => {
    if (originalApiKey) {
      process.env.GIPHY_API_KEY = originalApiKey
    } else {
      delete process.env.GIPHY_API_KEY
    }
  })

  test('should return null if the guild has disabled GIFs', async () => {
    mockThemeValue = 'disabled'
    const result = await gifService.getGif('excited', 'guild-123')
    expect(result).toBeNull()
  })

  test('should query GIPHY API when GIPHY_API_KEY is available', async () => {
    process.env.GIPHY_API_KEY = 'test-giphy-key'
    
    const mockGiphyResponse = {
      data: {
        data: [
          { images: { original: { url: 'https://giphy.com/test.gif' } } }
        ]
      }
    }
    axios.get.mockResolvedValueOnce(mockGiphyResponse)

    const result = await gifService.getGif('excited', 'guild-123')

    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('api.giphy.com/v1/gifs/search'))
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('api_key=test-giphy-key'))
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('q=excited'))
    expect(result).toBe('https://giphy.com/test.gif')
  })

  test('should append anime to Giphy query when theme is anime', async () => {
    process.env.GIPHY_API_KEY = 'test-giphy-key'
    mockThemeValue = 'anime'

    const mockGiphyResponse = {
      data: {
        data: [
          { images: { original: { url: 'https://giphy.com/anime-test.gif' } } }
        ]
      }
    }
    axios.get.mockResolvedValueOnce(mockGiphyResponse)

    const result = await gifService.getGif('dance', 'guild-123')

    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('q=dance%20anime'))
    expect(result).toBe('https://giphy.com/anime-test.gif')
  })

  test('should fallback to nekos.best when no GIPHY key and theme is anime', async () => {
    mockThemeValue = 'anime'

    const mockNekosResponse = {
      data: {
        results: [
          { url: 'https://nekos.best/anime-reaction.gif' }
        ]
      }
    }
    axios.get.mockResolvedValueOnce(mockNekosResponse)

    const result = await gifService.getGif('crying', 'guild-123')

    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('nekos.best/api/v2/cry'))
    expect(result).toBe('https://nekos.best/anime-reaction.gif')
  })

  test('should fallback to curated reaction GIF when no GIPHY key and theme is default', async () => {
    const result = await gifService.getGif('facepalm', 'guild-123')
    
    // Curated facepalm list has direct Giphy links
    expect(result).toContain('media.giphy.com/media/')
    expect(result).toContain('giphy.gif')
  })
})
