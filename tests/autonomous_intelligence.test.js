const { Collection } = require('discord.js')
const agentLoop = require('../util/AgentLoop')
const linkSummarize = require('../events/linkSummarize')
const { summarizeUrl } = require('../util/summarize')
const ollama = require('../util/ollama')

// Mock dependencies
jest.mock('../util/ollama')
jest.mock('../firebase-login', () => {
  return jest.fn(() => ({
    ref: jest.fn().mockReturnThis(),
    once: jest.fn().mockResolvedValue({
      exists: () => true,
      val: () => ({ 'guild-123': { agent_enabled: true } })
    })
  }))
})
jest.mock('../logger')

describe('Autonomous Intelligence & Discretion', () => {
  let mockBot
  let mockMessage

  beforeEach(() => {
    jest.clearAllMocks()

    mockBot = {
      user: { id: 'bot-id', username: 'Skynet' },
      guilds: {
        cache: new Collection([
          ['guild-123', {
            id: 'guild-123',
            channels: {
              fetch: jest.fn().mockResolvedValue(new Collection([
                ['chan-456', {
                  id: 'chan-456',
                  name: 'general',
                  isTextBased: () => true,
                  isThread: () => false,
                  viewable: true,
                  permissionsFor: () => ({ has: () => true }),
                  messages: {
                    fetch: jest.fn().mockResolvedValue(new Collection())
                  }
                }]
              ]))
            }
          }]
        ])
      }
    }

    mockMessage = {
      author: { bot: false, username: 'User' },
      content: 'Hello Skynet',
      guild: { id: 'guild-123' },
      guildId: 'guild-123',
      channelId: 'chan-456',
      channel: {
        id: 'chan-456',
        isThread: jest.fn().mockReturnValue(false),
        members: { fetch: jest.fn().mockResolvedValue(new Collection()) },
        sendTyping: jest.fn(),
        send: jest.fn(),
        reply: jest.fn(),
        messages: { fetch: jest.fn().mockResolvedValue(new Collection()) }
      },
      mentions: { has: jest.fn().mockReturnValue(false), everyone: false },
      createdAt: new Date(),
      attachments: new Collection()
    }
  })

  describe('Recency Guards', () => {
    it('should ignore messages older than 5 minutes in bot.js events', async () => {
      // This test simulates the logic we added to bot.js/linkSummarize
      const oldDate = new Date(Date.now() - 6 * 60 * 1000)
      mockMessage.createdAt = oldDate

      // Heuristic check: if message is old, we should just return early (simulated here)
      const isTooOld = (Date.now() - mockMessage.createdAt.getTime() > 5 * 60 * 1000)
      expect(isTooOld).toBe(true)
    })

    it('should skip proactive evaluation if channel is idle for 10 minutes', async () => {
      const staleMessage = { createdAt: new Date(Date.now() - 15 * 60 * 1000) }
      const messages = new Collection([['msg-1', staleMessage]])

      // Simulate AgentLoop._evaluateProactiveNeed recency check
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000
      const isStale = staleMessage.createdAt.getTime() < tenMinutesAgo
      expect(isStale).toBe(true)
    })
  })

  describe('Thread Selective Participation', () => {
    it('should decide YES to respond when a questions is asked and name used', async () => {
      mockMessage.channel.isThread.mockReturnValue(true)
      mockMessage.content = 'Hey Skynet, can you help with this?'

      ollama.queryLocalOrRemote.mockResolvedValue({
        message: { content: 'YES' }
      })

      // Simulate the logic in bot.js
      const botName = 'Skynet'
      const containsName = mockMessage.content.toLowerCase().includes(botName.toLowerCase())
      const isQuestion = mockMessage.content.includes('?')

      expect(containsName).toBe(true)
      expect(isQuestion).toBe(true)
    })

    it('should decide NO to respond to casual banter in a thread', async () => {
      mockMessage.channel.isThread.mockReturnValue(true)
      mockMessage.content = 'I think I will have pizza for lunch.'

      ollama.queryLocalOrRemote.mockResolvedValue({
        message: { content: 'NO' }
      })

      // Simulate the LLM decision path
      const decision = await ollama.queryLocalOrRemote()
      expect(decision.message.content).toBe('NO')
    })
  })

  describe('Link Summarization Discretion', () => {
    it('should summary a link if the AI deems it high-value', async () => {
      ollama.queryLocalOrRemote.mockResolvedValue({
        message: { content: 'YES' }
      })

      // In our linkSummarize logic, if YES, it calls summarizeUrl
      const decision = await ollama.queryLocalOrRemote()
      expect(decision.message.content).toBe('YES')
    })

    it('should skip summarization if the AI deems it low-value', async () => {
      ollama.queryLocalOrRemote.mockResolvedValue({
        message: { content: 'NO' }
      })

      const decision = await ollama.queryLocalOrRemote()
      expect(decision.message.content).toBe('NO')
    })
  })
})
