jest.mock('@ngrok/ngrok', () => ({
  connect: jest.fn(),
  disconnect: jest.fn().mockResolvedValue()
}))
jest.mock('../logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}))

const ngrok = require('@ngrok/ngrok')
const getURL = require('../server/ngrok')

describe('ngrok.getURL', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.TWITCH_CALLBACK_URL
  })

  test('returns a tunnel URL when ngrok connects successfully', async () => {
    ngrok.connect.mockResolvedValueOnce({ url: () => 'https://abc123.ngrok.io' })

    const url = await getURL()

    expect(url).toBe('https://abc123.ngrok.io')
    expect(ngrok.connect).toHaveBeenCalled()
  })

  test('returns undefined and does not throw when ngrok fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    ngrok.connect.mockRejectedValueOnce(new Error('session limit reached'))

    const url = await getURL()

    expect(url).toBeUndefined()
    consoleSpy.mockRestore()
  })

  test('returns process.env.TWITCH_CALLBACK_URL when specified and bypasses ngrok', async () => {
    process.env.TWITCH_CALLBACK_URL = 'https://sirian.ddns.net'

    const url = await getURL()

    expect(url).toBe('https://sirian.ddns.net')
    expect(ngrok.connect).not.toHaveBeenCalled()
  })
})
