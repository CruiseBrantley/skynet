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

  test('initializes new game with board embed, buttons, and dropdowns', async () => {
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
    expect(callArg.components.length).toBe(3)
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

  test('correctly handles column F for reveal (F1) and flag (FF8, flag F7)', async () => {
    const replyMock = jest.fn().mockResolvedValue({})
    // 1. Reveal F1
    const mockInteractionReveal = {
      channelId: 'test_chan',
      options: { getString: jest.fn().mockReturnValue('F1') },
      reply: replyMock
    }
    await command.execute(mockInteractionReveal)
    const state = await agentMemory.get('minesweeper.test_chan')
    const parsedState = typeof state === 'string' ? JSON.parse(state) : state
    expect(parsedState.revealed[0][5]).toBe(true)

    // 2. Flag F8 with FF8
    const mockInteractionFlagFF = {
      channelId: 'test_chan',
      options: { getString: jest.fn().mockReturnValue('FF8') },
      reply: replyMock
    }
    await command.execute(mockInteractionFlagFF)
    const callFlag = replyMock.mock.calls[1][0]
    expect(callFlag.embeds[0].data.description).toContain('🚩 Flagged tile **F8**')

    // 3. Flag F7 with "flag F7"
    const mockInteractionFlagWord = {
      channelId: 'test_chan',
      options: { getString: jest.fn().mockReturnValue('flag F7') },
      reply: replyMock
    }
    await command.execute(mockInteractionFlagWord)
    const callFlagWord = replyMock.mock.calls[2][0]
    expect(callFlagWord.embeds[0].data.description).toContain('🚩 Flagged tile **F7**')
  })

  test('resets game with action reset by posting a new message and leaving existing board untouched', async () => {
    const editMock = jest.fn().mockResolvedValue({})
    const replyMock = jest.fn().mockResolvedValue({ id: 'new_msg_456' })
    const mockInteraction = {
      channelId: 'test_chan',
      options: { getString: jest.fn().mockReturnValue('reset') },
      channel: {
        messages: {
          fetch: jest.fn().mockResolvedValue({ id: 'old_msg_123', edit: editMock })
        }
      },
      reply: replyMock
    }

    await agentMemory.set('minesweeper.test_chan', {
      board: null,
      revealed: Array.from({ length: 8 }, () => Array(8).fill(false)),
      flagged: Array.from({ length: 8 }, () => Array(8).fill(false)),
      gameOver: true,
      won: false,
      moves: 5,
      messageId: 'old_msg_123'
    })

    await command.execute(mockInteraction)
    expect(replyMock).toHaveBeenCalled()
    expect(editMock).not.toHaveBeenCalled()
    const call = replyMock.mock.calls[0][0]
    expect(call.embeds[0].data.description).toContain('Started a fresh game!')
  })

  test('opens Reveal and Flag modals from interactive buttons', async () => {
    const showModalMock = jest.fn().mockResolvedValue({})
    const mockRevealBtn = {
      customId: 'minesweeper_btn_reveal',
      channelId: 'test_chan',
      showModal: showModalMock
    }

    await command.handleButton(mockRevealBtn)
    expect(showModalMock).toHaveBeenCalled()
    const modalData = showModalMock.mock.calls[0][0].data
    expect(modalData.custom_id).toBe('minesweeper_modal_reveal')
    expect(modalData.title).toContain('Reveal')

    const mockFlagBtn = {
      customId: 'minesweeper_btn_flag',
      channelId: 'test_chan',
      showModal: showModalMock
    }
    await command.handleButton(mockFlagBtn)
    expect(showModalMock).toHaveBeenCalledTimes(2)
    const modalFlagData = showModalMock.mock.calls[1][0].data
    expect(modalFlagData.custom_id).toBe('minesweeper_modal_flag')
  })

  test('handles modal submissions to reveal or flag tiles', async () => {
    const updateMock = jest.fn().mockResolvedValue({})
    const mockModalSubmit = {
      customId: 'minesweeper_modal_reveal',
      channelId: 'test_chan',
      isModalSubmit: () => true,
      fields: {
        getTextInputValue: jest.fn().mockReturnValue('E4')
      },
      update: updateMock
    }

    await command.handleButton(mockModalSubmit)
    expect(updateMock).toHaveBeenCalled()
    const state = await agentMemory.get('minesweeper.test_chan')
    const parsedState = typeof state === 'string' ? JSON.parse(state) : state
    expect(parsedState.revealed[3][4]).toBe(true)
  })

  test('handles Column and Row select menus to play tile without typing', async () => {
    const updateMock = jest.fn().mockResolvedValue({})

    // 1. Select Column C
    const mockColSelect = {
      customId: 'minesweeper_select_col',
      channelId: 'test_chan',
      values: ['C'],
      update: updateMock
    }
    await command.handleButton(mockColSelect)
    let state = await agentMemory.get('minesweeper.test_chan')
    let parsedState = typeof state === 'string' ? JSON.parse(state) : state
    expect(parsedState.selectedCol).toBe('C')

    // 2. Select Row 5 -> triggers play of C5
    const mockRowSelect = {
      customId: 'minesweeper_select_row',
      channelId: 'test_chan',
      values: ['5'],
      update: updateMock
    }
    await command.handleButton(mockRowSelect)
    state = await agentMemory.get('minesweeper.test_chan')
    parsedState = typeof state === 'string' ? JSON.parse(state) : state
    // Once played, row and col selections are reset
    expect(parsedState.selectedCol).toBeNull()
    expect(parsedState.selectedRow).toBeNull()
    // Tile C5 (row 4, col 2) is revealed!
    expect(parsedState.revealed[4][2]).toBe(true)
  })

  test('toggles flag mode for dropdowns', async () => {
    const updateMock = jest.fn().mockResolvedValue({})
    const mockToggleBtn = {
      customId: 'minesweeper_btn_flag_toggle',
      channelId: 'test_chan',
      update: updateMock
    }

    await command.handleButton(mockToggleBtn)
    let state = await agentMemory.get('minesweeper.test_chan')
    let parsedState = typeof state === 'string' ? JSON.parse(state) : state
    expect(parsedState.flagMode).toBe(true)

    await command.handleButton(mockToggleBtn)
    state = await agentMemory.get('minesweeper.test_chan')
    parsedState = typeof state === 'string' ? JSON.parse(state) : state
    expect(parsedState.flagMode).toBe(false)
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
    expect(editMock).toHaveBeenCalled()
    expect(deferReplyMock).toHaveBeenCalled()
    expect(deleteReplyMock).toHaveBeenCalled()
  })
})
