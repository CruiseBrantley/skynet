const proactiveInsight = require('../util/chat/proactiveInsight')
const ollama = require('../util/ollama')
const { handleInteractionComponent } = require('../adapters/discord/interactions')

jest.mock('../util/ollama')

describe('proactiveInsight (Helpful Topic Insights with Ephemeral Buttons)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    proactiveInsight.clearInsightStore()
  })

  describe('storeInsight and getInsight', () => {
    test('stores and retrieves an insight by ID', () => {
      proactiveInsight.storeInsight('test1234', 'Detailed DirectX fix here', '💡 DirectX context')
      const retrieved = proactiveInsight.getInsight('test1234')

      expect(retrieved).not.toBeNull()
      expect(retrieved.content).toBe('Detailed DirectX fix here')
      expect(retrieved.teaser).toBe('💡 DirectX context')
    })

    test('returns null for nonexistent insight', () => {
      expect(proactiveInsight.getInsight('nonexistent')).toBeNull()
    })

    test('returns null if insight has exceeded TTL', () => {
      const item = proactiveInsight.storeInsight('exp1234', 'Old content', '💡 Old')
      // Simulate expired timestamp
      item.createdAt = Date.now() - (proactiveInsight.INSIGHT_TTL_MS + 1000)

      expect(proactiveInsight.getInsight('exp1234')).toBeNull()
    })
  })

  describe('generateTopicInsight', () => {
    test('parses valid JSON response from Ollama', async () => {
      ollama.queryOllama.mockResolvedValueOnce({
        response: JSON.stringify({
          teaser: '💡 Found a fix for the DirectX crash.',
          insight: 'In patch 14.18, switch from DX12 to DX11 in Riot client settings to resolve crashes.'
        })
      })

      const mockMessage = {
        author: { username: 'Gamer' },
        content: 'Why does my game keep crashing on DX12?'
      }

      const res = await proactiveInsight.generateTopicInsight(mockMessage)
      expect(res).not.toBeNull()
      expect(res.teaser).toBe('💡 Found a fix for the DirectX crash.')
      expect(res.insight).toContain('switch from DX12 to DX11')
    })

    test('returns null if response contains no JSON or insight is too short', async () => {
      ollama.queryOllama.mockResolvedValueOnce({
        response: 'I do not know how to help with that.'
      })

      const mockMessage = {
        author: { username: 'User' },
        content: 'hello'
      }

      const res = await proactiveInsight.generateTopicInsight(mockMessage)
      expect(res).toBeNull()
    })
  })

  describe('executeProactiveInsight', () => {
    test('replies with teaser and View Insight button', async () => {
      ollama.queryOllama.mockResolvedValueOnce({
        response: JSON.stringify({
          teaser: '💡 Relevant context on kernel panic.',
          insight: 'Kernel panics in macOS Sonoma often relate to external thunderbolt docks.'
        })
      })

      const mockReply = jest.fn().mockResolvedValue({ id: 'botMsg1' })
      const mockMessage = {
        id: 'userMsg1',
        author: { username: 'Dev' },
        content: 'My Mac had a kernel panic after connecting my dock',
        channel: { name: 'tech-support' },
        reply: mockReply
      }

      const res = await proactiveInsight.executeProactiveInsight(mockMessage, {})
      expect(res).not.toBeNull()
      expect(res.insightId).toBeDefined()
      expect(mockReply).toHaveBeenCalledTimes(1)

      const replyArgs = mockReply.mock.calls[0][0]
      expect(replyArgs.content).toBe('💡 Relevant context on kernel panic.')
      expect(replyArgs.components).toBeDefined()
      expect(replyArgs.components[0].components[0].data.label).toBe('View Insight')
      expect(replyArgs.components[0].components[0].data.custom_id).toMatch(/^insight:/)

      // Cached content matches
      const cached = proactiveInsight.getInsight(res.insightId)
      expect(cached).not.toBeNull()
      expect(cached.content).toContain('Kernel panics in macOS Sonoma')
    })

    test('falls back to channel.send if message.reply throws', async () => {
      ollama.queryOllama.mockResolvedValueOnce({
        response: JSON.stringify({
          teaser: '💡 Audio routing troubleshooting info.',
          insight: 'Check CoreAudio aggregate device settings.'
        })
      })

      const mockSend = jest.fn().mockResolvedValue({ id: 'botMsg2' })
      const mockMessage = {
        id: 'userMsg2',
        author: { username: 'Musician' },
        content: 'Audio interface stopped routing sound',
        channel: { name: 'audio', send: mockSend },
        reply: jest.fn().mockRejectedValue(new Error('Unknown message'))
      }

      const res = await proactiveInsight.executeProactiveInsight(mockMessage, {})
      expect(res).not.toBeNull()
      expect(mockSend).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleInsightButton', () => {
    test('replies ephemerally with cached insight', async () => {
      proactiveInsight.storeInsight('abc1234', 'Here is the full solution.', '💡 Fix')

      const mockReply = jest.fn().mockResolvedValue()
      const mockInteraction = {
        customId: 'insight:abc1234',
        reply: mockReply
      }

      await proactiveInsight.handleInsightButton(mockInteraction)
      expect(mockReply).toHaveBeenCalledTimes(1)
      const replyArgs = mockReply.mock.calls[0][0]
      expect(replyArgs.content).toBe('Here is the full solution.')
      expect(replyArgs.flags).toBeDefined()
    })

    test('replies ephemerally with expiration message if insight missing', async () => {
      const mockReply = jest.fn().mockResolvedValue()
      const mockInteraction = {
        customId: 'insight:expiredId',
        reply: mockReply
      }

      await proactiveInsight.handleInsightButton(mockInteraction)
      expect(mockReply).toHaveBeenCalledTimes(1)
      const replyArgs = mockReply.mock.calls[0][0]
      expect(replyArgs.content).toContain('expired')
    })
  })

  describe('Interaction Component Router Integration', () => {
    test('routes insight: customId to handleInsightButton', async () => {
      proactiveInsight.storeInsight('btn123', 'Secret context', '💡 Teaser')

      const mockReply = jest.fn().mockResolvedValue()
      const mockInteraction = {
        isButton: () => true,
        customId: 'insight:btn123',
        reply: mockReply
      }

      const handled = await handleInteractionComponent(mockInteraction, {})
      expect(handled).toBe(true)
      expect(mockReply).toHaveBeenCalledTimes(1)
      expect(mockReply.mock.calls[0][0].content).toBe('Secret context')
    })
  })
})
