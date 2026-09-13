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

  test('initializes new game on empty action with circled row badges and separator', async () => {
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
    expect(callArg.embeds[0].data.description).toContain('🎯 ┃ 🇦 🇧 🇨 🇩 🇪 🇫 🇬 🇭')
    expect(callArg.embeds[0].data.description).toContain('1️⃣ ┃ ⬛')
    expect(callArg.embeds[0].data.description).toContain('💣 **Mines Left:** `10`')
    expect(callArg.components).toEqual([])
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

  test('guarantees safe 0-tile opening on first click', async () => {
    const replyMock = jest.fn().mockResolvedValue({})
    const mockInteraction = {
      channelId: 'test_chan',
      options: { getString: jest.fn().mockReturnValue('D4') },
      reply: replyMock
    }

    await command.execute(mockInteraction)
    const state = await agentMemory.get('minesweeper.test_chan')
    const parsedState = typeof state === 'string' ? JSON.parse(state) : state
    expect(parsedState.board[3][3]).toBe(0)
    // Safe zone around (3,3) ensures multiple tiles are revealed
    const revealedCount = parsedState.revealed.flat().filter(Boolean).length
    expect(revealedCount).toBeGreaterThanOrEqual(9)
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

  test('edits existing board message and deletes interacting slash command', async () => {
    const editMock = jest.fn().mockResolvedValue({})
    const mockBoardMsg = {
      id: 'existing_board_msg_123',
      edit: editMock
    }

    const deferReplyMock = jest.fn().mockResolvedValue({})
    const deleteReplyMock = jest.fn().mockResolvedValue({})

    const mockInteraction = {
      channelId: 'test_chan',
      options: { getString: jest.fn().mockReturnValue('C3') },
      channel: {
        messages: {
          fetch: jest.fn().mockImplementation((id) => {
            if (id === 'existing_board_msg_123') return Promise.resolve(mockBoardMsg)
            return Promise.resolve(null)
          })
        }
      },
      deferReply: deferReplyMock,
      deleteReply: deleteReplyMock
    }

    // Seed state with existing messageId
    await agentMemory.set('minesweeper.test_chan', {
      board: null,
      revealed: Array.from({ length: 8 }, () => Array(8).fill(false)),
      flagged: Array.from({ length: 8 }, () => Array(8).fill(false)),
      gameOver: false,
      won: false,
      moves: 0,
      messageId: 'existing_board_msg_123'
    })

    await command.execute(mockInteraction)

    // Verify existing message was edited in place
    expect(editMock).toHaveBeenCalled()

    // Verify incoming slash command was deferred and deleted
    expect(deferReplyMock).toHaveBeenCalled()
    expect(deleteReplyMock).toHaveBeenCalled()
  })
})
