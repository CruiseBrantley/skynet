const chat = require('../commands/chat')
const executor = require('../util/ActionExecutor')
const { queryOllamaWithContext } = require('../util/ollama')
const { fetchPageText } = require('../util/summarize')
const googleIt = require('google-it')

// Mock external dependencies
jest.mock('../util/ollama')
jest.mock('../util/summarize')
jest.mock('google-it')

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

    // 2. Google-it finds results
    googleIt.mockResolvedValueOnce([
      { title: 'Local Weather', link: 'https://weather.com/local', snippet: 'Sunny and 75F' }
    ])

    // 3. Scraper extracts "body" text
    fetchPageText.mockResolvedValueOnce('The weather today in Fayetteville is sunny with a high of 75F and low of 50F.')

    // 4. AI provides final summary
    queryOllamaWithContext.mockResolvedValueOnce({
      message: { content: 'The weather in Fayetteville is currently sunny and 75F.' }
    })

    // Execute the command
    await chat.execute(mockInteraction, {})

    // VERIFICATIONS

    // Should have called Ollama twice (Thought then Report)
    expect(queryOllamaWithContext).toHaveBeenCalledTimes(2)

    // Should have called google-it
    expect(googleIt).toHaveBeenCalled()

    // Should have called fetchPageText for the found link
    expect(fetchPageText).toHaveBeenCalledWith('https://weather.com/local', expect.any(Number))

    // Should have OVERWRITTEN the thinking status in editReply with the final summary
    expect(mockInteraction.editReply).toHaveBeenCalled()
    const lastEdit = mockInteraction.editReply.mock.calls[mockInteraction.editReply.mock.calls.length - 1][0]
    const content = typeof lastEdit === 'string' ? lastEdit : lastEdit.content

    expect(content).toContain('weather')
    expect(content).toContain('75F')
  })
})
