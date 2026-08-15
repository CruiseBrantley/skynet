const action = require('../util/actions/send_gif')
const gifService = require('../util/chat/gifService')

jest.mock('../util/chat/gifService')
jest.mock('../logger')

describe('Built-in Action - send_gif', () => {
  let mockChannel

  beforeEach(() => {
    jest.clearAllMocks()
    mockChannel = {
      guildId: 'guild-123',
      send: jest.fn().mockResolvedValue({ id: 'msg_1' })
    }
  })

  test('should fetch gif from service and send it to the channel', async () => {
    gifService.getGif.mockResolvedValueOnce('https://giphy.com/happy.gif')

    await action.execute(null, mockChannel, { search_query: 'happy reaction' })

    expect(gifService.getGif).toHaveBeenCalledWith('happy reaction', 'guild-123')
    expect(mockChannel.send).toHaveBeenCalledWith({ embeds: [expect.objectContaining({ data: expect.objectContaining({ image: { url: 'https://giphy.com/happy.gif' } }) })] })
  })

  test('should handle missing parameters and fallback to happy query', async () => {
    gifService.getGif.mockResolvedValueOnce('https://giphy.com/happy-fallback.gif')

    await action.execute(null, mockChannel, {})

    expect(gifService.getGif).toHaveBeenCalledWith('happy', 'guild-123')
    expect(mockChannel.send).toHaveBeenCalledWith({ embeds: [expect.objectContaining({ data: expect.objectContaining({ image: { url: 'https://giphy.com/happy-fallback.gif' } }) })] })
  })

  test('should handle null response from service (disabled)', async () => {
    gifService.getGif.mockResolvedValueOnce(null)

    await action.execute(null, mockChannel, { search_query: 'excited' })

    expect(mockChannel.send).not.toHaveBeenCalled()
  })
})
