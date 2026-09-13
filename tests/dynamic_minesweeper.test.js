// Unit tests for slash command /minesweeper
const command = require('../commands/minesweeper')
const agentMemory = require('../util/AgentMemory')

describe('Dynamic Slash Command: /minesweeper', () => {
  beforeEach(async () => {
    await agentMemory.delete('minesweeper.test_chan')
  })

  test('exports valid SlashCommandBuilder and execute handler', () => {
    expect(command).toBeDefined()
    expect(command.data).toBeDefined()
    expect(command.data.name).toBe('minesweeper')
    expect(typeof command.execute).toBe('function')
    expect(typeof command.handleButton).toBe('function')
  })

  test('initializes new game on empty action', async () => {
    const replyMock = jest.fn().mockResolvedValue({})
    const mockInteraction = {
      channelId: 'test_chan',
      options: { getString: jest.fn().mockReturnValue(null) },
      reply: replyMock
    }

    await command.execute(mockInteraction)
    expect(replyMock).toHaveBeenCalled()
    const callArg = replyMock.mock.calls[0][0]
    expect(callArg.embeds).toBeDefined()
    expect(callArg.embeds[0].data.title).toContain('Minesweeper')
    expect(callArg.embeds[0].data.description).toContain('🇦 🇧 🇨 🇩 🇪 🇫 🇬 🇭')
    expect(callArg.components).toBeDefined()
  })

  test('reveals a cell with coordinates in either order (D1 or 1D)', async () => {
    const replyMock = jest.fn().mockResolvedValue({})
    const mockInteraction1 = {
      channelId: 'test_chan',
      options: { getString: jest.fn().mockReturnValue('D1') },
      reply: replyMock
    }

    await command.execute(mockInteraction1)
    expect(replyMock).toHaveBeenCalled()

    const mockInteraction2 = {
      channelId: 'test_chan',
      options: { getString: jest.fn().mockReturnValue('2D') },
      reply: replyMock
    }
    await command.execute(mockInteraction2)
    expect(replyMock).toHaveBeenCalledTimes(2)
  })

  test('flags and unflags a cell with FD1 and 1DF', async () => {
    const replyMock = jest.fn().mockResolvedValue({})
    const mockInteractionFlag = {
      channelId: 'test_chan',
      options: { getString: jest.fn().mockReturnValue('FD1') },
      reply: replyMock
    }

    await command.execute(mockInteractionFlag)
    const call1 = replyMock.mock.calls[0][0]
    expect(call1.embeds[0].data.description).toContain('🚩 Flagged tile **D1**')

    const mockInteractionUnflag = {
      channelId: 'test_chan',
      options: { getString: jest.fn().mockReturnValue('1DF') },
      reply: replyMock
    }

    await command.execute(mockInteractionUnflag)
    const call2 = replyMock.mock.calls[1][0]
    expect(call2.embeds[0].data.description).toContain('🏳️ Unflagged tile **D1**')
  })

  test('resets game with action reset', async () => {
    const replyMock = jest.fn().mockResolvedValue({})
    const mockInteraction = {
      channelId: 'test_chan',
      options: { getString: jest.fn().mockReturnValue('reset') },
      reply: replyMock
    }

    await command.execute(mockInteraction)
    expect(replyMock).toHaveBeenCalled()
    const call = replyMock.mock.calls[0][0]
    expect(call.embeds[0].data.description).toContain('🔄 Started a fresh game!')
  })

  test('recovers smoothly from corrupt non-object memory', async () => {
    await agentMemory.set('minesweeper.test_chan', '[object Object]')
    const replyMock = jest.fn().mockResolvedValue({})
    const mockInteraction = {
      channelId: 'test_chan',
      options: { getString: jest.fn().mockReturnValue('A1') },
      reply: replyMock
    }

    await expect(command.execute(mockInteraction)).resolves.not.toThrow()
    expect(replyMock).toHaveBeenCalled()
  })

  test('handles buttons for new game and help', async () => {
    const updateMock = jest.fn().mockResolvedValue({})
    const mockButtonInteraction = {
      customId: 'minesweeper_new',
      channelId: 'test_chan',
      update: updateMock
    }

    await command.handleButton(mockButtonInteraction)
    expect(updateMock).toHaveBeenCalled()

    const replyMock = jest.fn().mockResolvedValue({})
    const mockHelpInteraction = {
      customId: 'minesweeper_help',
      channelId: 'test_chan',
      reply: replyMock
    }

    await command.handleButton(mockHelpInteraction)
    expect(replyMock).toHaveBeenCalled()
    expect(replyMock.mock.calls[0][0].content).toContain('Minesweeper Controls')
  })
})

