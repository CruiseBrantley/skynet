const researchCmd = require('../commands/research')
const { queryOllamaWithContext, getActiveModelCapabilities } = require('../util/ollama')
const ActionExecutor = require('../util/ActionExecutor')

jest.mock('../logger')
jest.mock('../util/ollama')
jest.mock('../util/ActionExecutor')

describe('commands/research', () => {
  let mockInteraction

  beforeEach(() => {
    jest.clearAllMocks()
    getActiveModelCapabilities.mockResolvedValue({
      tier: 'remote_5090',
      supportsDeepResearch: true
    })

    mockInteraction = {
      guildId: 'guild123',
      user: { id: 'user123', username: 'testuser' },
      options: {
        getString: jest.fn().mockReturnValue('10GbE network switches 2026')
      },
      deferReply: jest.fn().mockResolvedValue(),
      editReply: jest.fn().mockResolvedValue(),
      reply: jest.fn().mockResolvedValue()
    }

    ActionExecutor.execute.mockResolvedValue({
      result: 'Top switches: Switch A, Switch B'
    })

    queryOllamaWithContext.mockResolvedValue({
      message: { content: 'Executive Summary: Switch A is best.' }
    })
  })

  test('executes web search and posts research embed', async () => {
    await researchCmd.execute(mockInteraction)

    expect(mockInteraction.deferReply).toHaveBeenCalled()
    expect(ActionExecutor.execute).toHaveBeenCalledWith('web_search', { query: '10GbE network switches 2026' })
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }))
  })
})
