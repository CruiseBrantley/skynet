const chat = require('../commands/chat')
const { queryOllamaWithContext, queryOllama } = require('../util/ollama')
const wiki = require('wikipedia')

// Mock external dependencies
jest.mock('../util/ollama')
jest.mock('wikipedia')

describe('Weather Search E2E Flow', () => {
  let mockInteraction

  beforeEach(() => {
    jest.clearAllMocks()

    mockInteraction = {
      guildId: '123',
      channelId: '456',
      user: { id: '789', tag: 'sirian#0000', username: 'sirian' },
      member: { id: '789', nickname: 'Sirian' },
      client: {
        user: { id: '555', username: 'Skynet' },
        commands: {
          get: jest.fn().mockReturnValue(null),
          map: jest.fn().mockReturnValue([])
        }
      },
      options: {
        getString: jest.fn().mockReturnValue('What is the weather in Fayetteville?'),
        getAttachment: jest.fn().mockReturnValue(null)
      },
      channel: {
        id: '456',
        messages: { fetch: jest.fn().mockResolvedValue(new Map()) },
        send: jest.fn().mockResolvedValue({})
      },
      deferReply: jest.fn().mockResolvedValue({}),
      editReply: jest.fn().mockResolvedValue({}),
      followUp: jest.fn().mockResolvedValue({}),
      deleteReply: jest.fn().mockResolvedValue({}),
      edit: jest.fn().mockResolvedValue({})
    }
  })

  test('should execute full chain: AI -> web_search -> scrape -> AI Summary', async () => {
    // 1. AI decides to search
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { content: '<<<RUN_COMMAND: {"command": "web_search", "params": {"query": "weather Fayetteville AR"}}>>>' }
    })

    // 2. Wikipedia lookup returns summary
    wiki.search.mockResolvedValueOnce({ results: [{ title: 'Fayetteville, Arkansas' }] })
    wiki.summary.mockResolvedValueOnce({
      title: 'Fayetteville, Arkansas',
      extract: 'The climate in Fayetteville is humid subtropical with warm summers and mild winters.',
      content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Fayetteville' } }
    })

    // 3. Local model distillation
    queryOllama.mockResolvedValueOnce({
      response: 'Fayetteville, AR has a humid subtropical climate with sunny skies and mild weather today.'
    })

    // 4. AI provides final summary
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { content: 'The weather in Fayetteville is currently sunny and 75F.' }
    })

    // 5. Coordinator evaluation confirming completion
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { content: JSON.stringify({ has_pending_work: false }) }
    })

    // Execute the command
    await chat.execute(mockInteraction, {})

    // VERIFICATIONS

    // Should have called Ollama (Initial + Summary + Coordinator)
    expect(queryOllamaWithContext).toHaveBeenCalledTimes(3)

    // Should have called Wikipedia search
    expect(wiki.search).toHaveBeenCalledWith(expect.stringContaining('weather Fayetteville'), expect.any(Object))

    // Should have OVERWRITTEN the thinking status in editReply with the final summary
    expect(mockInteraction.editReply).toHaveBeenCalled()
    const lastEdit = mockInteraction.editReply.mock.calls[mockInteraction.editReply.mock.calls.length - 1][0]
    const content = typeof lastEdit === 'string' ? lastEdit : lastEdit.content

    expect(content).toContain('weather')
    expect(content).toContain('75F')
  })
})
