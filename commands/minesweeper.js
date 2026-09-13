const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js')
const { SafeEmbedBuilder: EmbedBuilder } = require('../util/discordFormatter')
const agentMemory = require('../util/AgentMemory')
const logger = require('../logger')

const ROWS = 8
const COLS = 8
const MINES = 10

const COL_HEADERS = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭']
const ROW_HEADERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣']
const NUM_EMOJIS = ['⬜', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣']
const TILE = {
  hidden: '⬛',
  empty: '⬜',
  flag: '🚩',
  mine: '💣',
  exploded: '💥',
  falseFlag: '❌'
}

function createEmptyBoard () {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0))
}

function placeMines (firstRow = -1, firstCol = -1) {
  const board = createEmptyBoard()
  let placed = 0

  const isSafeZone = (r, c) => {
    if (firstRow === -1 || firstCol === -1) return false
    return Math.abs(r - firstRow) <= 1 && Math.abs(c - firstCol) <= 1
  }

  while (placed < MINES) {
    const r = Math.floor(Math.random() * ROWS)
    const c = Math.floor(Math.random() * COLS)
    if (isSafeZone(r, c) || board[r][c] === -1) continue
    board[r][c] = -1
    placed++
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] === -1) continue
      let count = 0
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr
          const nc = c + dc
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && board[nr][nc] === -1) {
            count++
          }
        }
      }
      board[r][c] = count
    }
  }
  return board
}

function newGame () {
  return {
    board: null,
    revealed: Array.from({ length: ROWS }, () => Array(COLS).fill(false)),
    flagged: Array.from({ length: ROWS }, () => Array(COLS).fill(false)),
    gameOver: false,
    won: false,
    moves: 0,
    explodedR: -1,
    explodedC: -1,
    flagMode: false,
    selectedCol: null,
    selectedRow: null
  }
}

function floodReveal (game, startR, startC) {
  const stack = [[startR, startC]]
  while (stack.length > 0) {
    const [r, c] = stack.pop()
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue
    if (game.revealed[r][c] || game.flagged[r][c]) continue

    game.revealed[r][c] = true

    if (game.board[r][c] === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const nr = r + dr
          const nc = c + dc
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && !game.revealed[nr][nc] && !game.flagged[nr][nc]) {
            stack.push([nr, nc])
          }
        }
      }
    }
  }
}

function checkWin (game) {
  let revealedCount = 0
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (game.board[r][c] !== -1 && game.revealed[r][c]) {
        revealedCount++
      }
    }
  }
  if (revealedCount === (ROWS * COLS) - MINES) {
    game.won = true
    game.gameOver = true
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (game.board[r][c] === -1) {
          game.flagged[r][c] = true
        }
      }
    }
  }
}

function applyAction (game, parsed) {
  if (game.gameOver) {
    return '⚠️ Game is already over! Start a new game with `/minesweeper action:new`.'
  }

  if (parsed.type === 'flag') {
    const { row, col, coordLabel } = parsed
    if (game.revealed[row][col]) {
      return `⚠️ Cannot flag **${coordLabel}** — it is already revealed.`
    }
    game.flagged[row][col] = !game.flagged[row][col]
    return game.flagged[row][col]
      ? `🚩 Flagged tile **${coordLabel}**.`
      : `🏳️ Unflagged tile **${coordLabel}**.`
  }

  if (parsed.type === 'reveal') {
    const { row, col, coordLabel } = parsed
    if (game.flagged[row][col]) {
      return `🚩 Tile **${coordLabel}** is flagged. Unflag it first with \`F${coordLabel}\`.`
    }
    if (game.revealed[row][col]) {
      return `ℹ️ Tile **${coordLabel}** is already revealed.`
    }

    if (!game.board) {
      game.board = placeMines(row, col)
    }

    game.moves++

    if (game.board[row][col] === -1) {
      game.gameOver = true
      game.explodedR = row
      game.explodedC = col
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (game.board[r][c] === -1) {
            game.revealed[r][c] = true
          }
        }
      }
      return ''
    } else {
      floodReveal(game, row, col)
      checkWin(game)
      return ''
    }
  }

  return ''
}

function parseAction (rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return null
  const input = rawInput.trim().toLowerCase()

  if (input === 'reset' || input === 'new' || input === 'restart') {
    return { type: 'reset' }
  }

  let isFlag = false
  let text = input

  if (text.includes('flag') || text.includes('🚩')) {
    isFlag = true
    text = text.replace(/flag/g, '').replace(/🚩/g, '')
  }

  text = text.replace(/\s+/g, '')

  const rowMatch = text.match(/[1-8]/)
  if (!rowMatch) return { type: 'invalid' }
  const row = parseInt(rowMatch[0], 10) - 1

  const letters = text.replace(/[1-8]/g, '')

  let colChar = null

  if (letters.length === 1) {
    if (letters >= 'a' && letters <= 'h') {
      colChar = letters
    }
  } else if (letters.length === 2) {
    if (letters.includes('f')) {
      isFlag = true
      const remaining = letters.replace('f', '')
      if (remaining >= 'a' && remaining <= 'h') {
        colChar = remaining
      }
    }
  }

  if (!colChar) return { type: 'invalid' }

  const col = colChar.charCodeAt(0) - 97

  return {
    type: isFlag ? 'flag' : 'reveal',
    row,
    col,
    coordLabel: `${colChar.toUpperCase()}${rowMatch[0]}`
  }
}

function renderBoard (game) {
  const lines = []
  lines.push('🎯 ┃ ' + COL_HEADERS.join(' '))

  for (let r = 0; r < ROWS; r++) {
    const rowItems = []
    for (let c = 0; c < COLS; c++) {
      let icon = TILE.hidden
      if (game.flagged[r][c]) {
        if (game.gameOver && !game.won && game.board && game.board[r][c] !== -1) {
          icon = TILE.falseFlag
        } else {
          icon = TILE.flag
        }
      } else if (!game.revealed[r][c]) {
        icon = TILE.hidden
      } else if (game.board && game.board[r][c] === -1) {
        icon = (game.explodedR === r && game.explodedC === c) ? TILE.exploded : TILE.mine
      } else if (game.board) {
        const count = game.board[r][c]
        icon = NUM_EMOJIS[count] || TILE.empty
      } else {
        icon = TILE.empty
      }
      rowItems.push(icon)
    }
    lines.push(`${ROW_HEADERS[r]} ┃ ${rowItems.join(' ')}`)
  }

  return lines.join('\n')
}

function buildComponents (game) {
  if (!game || game.gameOver) {
    return []
  }

  const isFlagOn = Boolean(game.flagMode)

  // Row 1: Action & Toggle Buttons
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('minesweeper_btn_reveal')
      .setLabel('⛏️ Reveal (Type)')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('minesweeper_btn_flag')
      .setLabel('🚩 Flag (Type)')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('minesweeper_btn_flag_toggle')
      .setLabel(isFlagOn ? '🚩 Mode: Flag ON' : '⛏️ Mode: Dig')
      .setStyle(isFlagOn ? ButtonStyle.Danger : ButtonStyle.Secondary)
  )

  // Row 2: Column Dropdown
  const colMenu = new StringSelectMenuBuilder()
    .setCustomId('minesweeper_select_col')
    .setPlaceholder(game.selectedCol ? `Selected Column: ${game.selectedCol}` : '🎯 Select Column (A – H)...')
    .addOptions(
      COL_HEADERS.map((emoji, i) => {
        const letter = String.fromCharCode(65 + i)
        return {
          label: `Column ${letter}`,
          value: letter,
          emoji,
          default: game.selectedCol === letter
        }
      })
    )
  const colRow = new ActionRowBuilder().addComponents(colMenu)

  // Row 3: Row Dropdown
  const rowMenu = new StringSelectMenuBuilder()
    .setCustomId('minesweeper_select_row')
    .setPlaceholder(game.selectedRow ? `Selected Row: ${game.selectedRow}` : '🔢 Select Row (1 – 8)...')
    .addOptions(
      ROW_HEADERS.map((emoji, i) => {
        const num = String(i + 1)
        return {
          label: `Row ${num}`,
          value: num,
          emoji,
          default: game.selectedRow === num
        }
      })
    )
  const rowSelectRow = new ActionRowBuilder().addComponents(rowMenu)

  return [buttonRow, colRow, rowSelectRow]
}

function buildEmbed (game, notice = '') {
  const boardStr = renderBoard(game)
  let statusText = ''

  if (game.won) {
    statusText = `🏆 **VICTORY!** All safe tiles cleared in ${game.moves} move${game.moves === 1 ? '' : 's'}!`
  } else if (game.gameOver) {
    statusText = `💥 **BOOM! GAME OVER!** Stumbled on a mine on move ${game.moves}.`
  }

  const flagCount = Array.isArray(game.flagged)
    ? game.flagged.reduce((acc, row) => acc + (Array.isArray(row) ? row.filter(Boolean).length : 0), 0)
    : 0
  const remainingMines = Math.max(MINES - flagCount, 0)

  const hud = `💣 **Mines Left:** \`${remainingMines}\`  •  🚩 **Flags:** \`${flagCount}\`  •  👟 **Moves:** \`${game.moves}\``

  let description = `${hud}\n\n${boardStr}`
  if (statusText) {
    description += `\n\n${statusText}`
  }
  if (notice && !statusText) {
    description += `\n\n> ${notice}`
  }

  return new EmbedBuilder()
    .setTitle('🎮 Minesweeper')
    .setDescription(description)
    .setColor(game.won ? 0x2ECC71 : game.gameOver ? 0xE74C3C : 0x5865F2)
    .setFooter({
      text: '8×8 Grid | ⛏️ Tap Dig/Flag or Pick Col+Row below | Reset: /minesweeper action:new'
    })
}

async function handleInteraction (interaction) {
  const customId = interaction.customId
  if (!customId || !customId.startsWith('minesweeper')) return

  const memKey = 'minesweeper.' + (interaction.channelId || 'dm')
  let raw = await agentMemory.get(memKey)
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch (_) {
      raw = null
    }
  }
  const game = raw || newGame()

  // 1. Button: Open Reveal Modal
  if (customId === 'minesweeper_btn_reveal') {
    const modal = new ModalBuilder()
      .setCustomId('minesweeper_modal_reveal')
      .setTitle('⛏️ Reveal Tile')
    const input = new TextInputBuilder()
      .setCustomId('minesweeper_input_coord')
      .setLabel('Coordinates to Reveal (e.g. D1, 1D, F1)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('D1')
      .setMinLength(2)
      .setMaxLength(4)
      .setRequired(true)
    modal.addComponents(new ActionRowBuilder().addComponents(input))
    if (typeof interaction.showModal === 'function') {
      await interaction.showModal(modal).catch(() => {})
    }
    return
  }

  // 2. Button: Open Flag Modal
  if (customId === 'minesweeper_btn_flag') {
    const modal = new ModalBuilder()
      .setCustomId('minesweeper_modal_flag')
      .setTitle('🚩 Flag / Unflag Tile')
    const input = new TextInputBuilder()
      .setCustomId('minesweeper_input_coord')
      .setLabel('Coordinates to Flag (e.g. D1, 1D, F1)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('D1')
      .setMinLength(2)
      .setMaxLength(4)
      .setRequired(true)
    modal.addComponents(new ActionRowBuilder().addComponents(input))
    if (typeof interaction.showModal === 'function') {
      await interaction.showModal(modal).catch(() => {})
    }
    return
  }

  // 3. Button: Toggle Flag Mode for Dropdowns
  if (customId === 'minesweeper_btn_flag_toggle') {
    game.flagMode = !game.flagMode
    await agentMemory.set(memKey, game, 30)
    const notice = game.flagMode
      ? '🚩 Dropdown Flag Mode is **ON** — selecting Col + Row will flag/unflag that tile.'
      : '⛏️ Dropdown Dig Mode is **ON** — selecting Col + Row will reveal that tile.'
    const embed = buildEmbed(game, notice)
    const components = buildComponents(game)
    if (typeof interaction.update === 'function') {
      await interaction.update({ embeds: [embed], components }).catch(() => {})
    }
    return
  }

  // 4. Modal Submission: Reveal or Flag
  if (interaction.isModalSubmit?.() || customId.startsWith('minesweeper_modal')) {
    const coordVal = interaction.fields?.getTextInputValue?.('minesweeper_input_coord') || ''
    const isFlagModal = customId === 'minesweeper_modal_flag'
    const fullAction = isFlagModal ? `flag ${coordVal}` : coordVal
    const parsed = parseAction(fullAction)
    let notice = ''

    if (!parsed || parsed.type === 'invalid') {
      notice = `⚠️ Invalid tile format: \`${coordVal}\`. Use \`D1\`, \`1D\`, or \`F1\`.`
    } else {
      notice = applyAction(game, parsed)
      await agentMemory.set(memKey, game, 30)
    }

    const embed = buildEmbed(game, notice)
    const components = buildComponents(game)
    if (typeof interaction.update === 'function') {
      await interaction.update({ embeds: [embed], components }).catch(async () => {
        if (typeof interaction.reply === 'function' && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ embeds: [embed], components, ephemeral: true }).catch(() => {})
        }
      })
    }
    return
  }

  // 5. Dropdown Selection: Column
  if (customId === 'minesweeper_select_col') {
    const selectedCol = interaction.values?.[0]
    game.selectedCol = selectedCol
    let notice = ''

    if (game.selectedCol && game.selectedRow) {
      const coordStr = `${game.selectedCol}${game.selectedRow}`
      const actionType = game.flagMode ? 'flag' : 'reveal'
      const parsed = {
        type: actionType,
        row: parseInt(game.selectedRow, 10) - 1,
        col: game.selectedCol.charCodeAt(0) - 65,
        coordLabel: coordStr
      }
      notice = applyAction(game, parsed)
      game.selectedCol = null
      game.selectedRow = null
      await agentMemory.set(memKey, game, 30)
    } else {
      await agentMemory.set(memKey, game, 30)
      notice = `Selected Column **${game.selectedCol}**. Now pick a Row below.`
    }

    const embed = buildEmbed(game, notice)
    const components = buildComponents(game)
    if (typeof interaction.update === 'function') {
      await interaction.update({ embeds: [embed], components }).catch(() => {})
    }
    return
  }

  // 6. Dropdown Selection: Row
  if (customId === 'minesweeper_select_row') {
    const selectedRow = interaction.values?.[0]
    game.selectedRow = selectedRow
    let notice = ''

    if (game.selectedCol && game.selectedRow) {
      const coordStr = `${game.selectedCol}${game.selectedRow}`
      const actionType = game.flagMode ? 'flag' : 'reveal'
      const parsed = {
        type: actionType,
        row: parseInt(game.selectedRow, 10) - 1,
        col: game.selectedCol.charCodeAt(0) - 65,
        coordLabel: coordStr
      }
      notice = applyAction(game, parsed)
      game.selectedCol = null
      game.selectedRow = null
      await agentMemory.set(memKey, game, 30)
    } else {
      await agentMemory.set(memKey, game, 30)
      notice = `Selected Row **${game.selectedRow}**. Now pick a Column above.`
    }

    const embed = buildEmbed(game, notice)
    const components = buildComponents(game)
    if (typeof interaction.update === 'function') {
      await interaction.update({ embeds: [embed], components }).catch(() => {})
    }
    return
  }

  // Legacy fallback button
  if (customId === 'minesweeper_new') {
    const freshGame = newGame()
    const embed = buildEmbed(freshGame, '🎮 Started a fresh Minesweeper game!')
    const components = buildComponents(freshGame)
    if (typeof interaction.reply === 'function') {
      const reply = await interaction.reply({ embeds: [embed], components, fetchReply: true }).catch(() => {})
      if (reply?.id) {
        freshGame.messageId = reply.id
        await agentMemory.set(memKey, freshGame, 30)
      }
    }
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('minesweeper')
    .setDescription('Play interactive Minesweeper in Discord')
    .addStringOption(opt =>
      opt.setName('action')
        .setDescription('Tile to reveal (D1 or 1D), flag (FD1 or 1DF), or reset. Leave empty to view board.')
        .setRequired(false)
    ),

  handleButton: handleInteraction,
  handleInteraction,

  execute: async (interaction) => {
    const memKey = 'minesweeper.' + (interaction.channelId || 'dm')
    let raw = await agentMemory.get(memKey)
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw)
      } catch (_) {
        raw = null
      }
    }

    let game = raw
    let isNewGame = false

    if (!game || !Array.isArray(game.revealed) || !Array.isArray(game.flagged)) {
      game = newGame()
      isNewGame = true
    }

    const actionRaw = interaction.options?.getString?.('action')
    let notice = ''

    if (actionRaw) {
      const parsed = parseAction(actionRaw)
      if (!parsed || parsed.type === 'invalid') {
        notice = `⚠️ Invalid tile format: \`${actionRaw}\`. Use \`D1\`, \`1D\`, or \`FD1\` to flag.`
      } else if (parsed.type === 'reset') {
        game = newGame()
        isNewGame = true
        notice = '🔄 Started a fresh game! Tap **Reveal** or pick Col+Row below.'
        await agentMemory.set(memKey, game, 30)
      } else if (game.gameOver) {
        notice = '⚠️ Game is already over! Start a new game with `/minesweeper action:new`.'
      } else {
        notice = applyAction(game, parsed)
        await agentMemory.set(memKey, game, 30)
      }
    } else if (game.gameOver) {
      game = newGame()
      isNewGame = true
      notice = '🎮 Started a fresh game! Tap **Reveal** or pick Col+Row below.'
      await agentMemory.set(memKey, game, 30)
    }

    // Locate the active board message in this channel ONLY if continuing an existing game
    let boardMsg = null
    if (!isNewGame) {
      if (game.messageId && interaction.channel?.messages?.fetch) {
        boardMsg = await interaction.channel.messages.fetch(game.messageId).catch(() => null)
      }

      if (!boardMsg && interaction.channel?.messages?.fetch) {
        const recent = await interaction.channel.messages.fetch({ limit: 15 }).catch(() => null)
        if (recent) {
          const botId = interaction.client?.user?.id || '558428214805135370'
          const existing = recent.find(m =>
            m.author?.id === botId &&
            m.embeds?.[0]?.title?.includes('Minesweeper')
          )
          if (existing) {
            boardMsg = existing
            game.messageId = existing.id
          }
        }
      }
    }

    const embed = buildEmbed(game, notice)
    const components = buildComponents(game)

    if (!isNewGame && boardMsg) {
      await interaction.deferReply().catch(() => {})

      await boardMsg.edit({ embeds: [embed], components }).catch(err => {
        logger.error(`Failed to update minesweeper board message: ${err.message}`)
      })

      await interaction.deleteReply().catch(err => {
        logger.warn(`Failed to delete slash command interaction: ${err.message}`)
      })
    } else {
      const reply = await interaction.reply({ embeds: [embed], components, fetchReply: true })
      if (reply?.id) {
        game.messageId = reply.id
        await agentMemory.set(memKey, game, 30)
      }
    }
  }
}
