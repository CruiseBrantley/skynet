const GuildQueue = require('../util/GuildQueue')
const { fetchAndFormatContext } = require('../util/chat/contextHelper')
const chatCommand = require('../commands/chat')

jest.mock('../util/chat/contextHelper')
jest.mock('../logger')
jest.mock('../util/ollama')
jest.mock('@discordjs/voice', () => ({
  createAudioPlayer: jest.fn().mockReturnValue({
    state: { status: 'idle' },
    on: jest.fn(),
    stop: jest.fn(),
    removeAllListeners: jest.fn(),
    play: jest.fn()
  }),
  AudioPlayerStatus: { Idle: 'idle' },
  VoiceConnectionStatus: { Disconnected: 'disconnected' }
}))

const { queryOllamaWithContext } = require('../util/ollama')

describe('Skynet Recent Updates Verification', () => {
  describe('GuildQueue - Autoplay Buffer Invalidation', () => {
    let queue
    beforeEach(() => {
      queue = new GuildQueue('guild-1', {})
      queue.autoplayBuffer = [{ url: 'http://youtube.com/watch?v=12345678901', title: 'Rec' }]
    })

    afterEach(() => {
      if (queue) queue.destroy()
    })

    test('clears buffer on manual track add', () => {
      queue.add({ url: 'http://youtube.com/watch?v=abcdefghijk', title: 'Manual' }, 'Cruise')
      expect(queue.autoplayBuffer.length).toBe(0)
    })

    test('does NOT clear buffer on autoplay add', () => {
      queue.add({ url: 'http://youtube.com/watch?v=abcdefghijk', title: 'Autoplay' }, 'Skynet Autoplay')
      expect(queue.autoplayBuffer.length).toBe(1)
    })

    test('clears buffer on manual batch add', () => {
      queue.addBatch([{ url: 'http://youtube.com/watch?v=abcdefghijk', title: 'Manual' }], 'Cruise')
      expect(queue.autoplayBuffer.length).toBe(0)
    })
  })

  describe('Context Bootstrapping', () => {
    let mockInteraction
    const channelId = 'channel-1'

    beforeEach(() => {
      jest.clearAllMocks()
      mockInteraction = {
        id: 'msg-current',
        channelId,
        channel: {
          id: channelId,
          messages: { fetch: jest.fn() },
          send: jest.fn().mockResolvedValue({})
        },
        client: { user: { id: 'bot-1' }, commands: new Map() },
        user: { username: 'user1' },
        member: { nickname: 'nick' },
        options: {
          getString: jest.fn().mockReturnValue('Hello'),
          getAttachment: jest.fn()
        },
        deferReply: jest.fn().mockResolvedValue(null),
        editReply: jest.fn().mockResolvedValue(null)
      }
      queryOllamaWithContext.mockResolvedValue({
        response: 'Test Response',
        usage: {}
      })
    })

    test('uses pre-fetched context if provided', async () => {
      mockInteraction.recentMessages = [{ role: 'user', content: 'Pre-fetched' }]
      const uniqueChannelId = `test-channel-${Date.now()}`
      mockInteraction.channelId = uniqueChannelId

      await chatCommand.execute(mockInteraction, {})

      expect(fetchAndFormatContext).not.toHaveBeenCalled()
    })

    test('fetches context if none provided', async () => {
      const uniqueChannelId = `test-channel-fetch-${Date.now()}`
      mockInteraction.channelId = uniqueChannelId
      fetchAndFormatContext.mockResolvedValue([{ role: 'user', content: 'Fetched' }])

      await chatCommand.execute(mockInteraction, {})

      expect(fetchAndFormatContext).toHaveBeenCalled()
    })
  })
})
