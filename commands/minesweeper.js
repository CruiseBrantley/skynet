const { SlashCommandBuilder } = require('discord.js')
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
    explodedC: -1
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

function parseAction (rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return null
  const input = rawInput.trim().toLowerCase()

  if (input === 'reset' || input === 'new' || input === 'restart') {
    return { type: 'reset' }
  }

  let isFlag = false
  let coord = input

  if (coord.startsWith('flag')) {
    isFlag = true
    coord = coord.replace(/^flag\s*/, '')
  } else if (coord.endsWith('flag')) {
    isFlag = true
    coord = coord.replace(/\s*flag$/, '')
  } else if (coord.startsWith('f')) {
    isFlag = true
    coord = coord.slice(1).trim()
  } else if (coord.endsWith('f')) {
    isFlag = true
    coord = coord.slice(0, -1).trim()
  }

  coord = coord.replace(/\s+/g, '')
  const colMatch = coord.match(/[a-h]/)
  const rowMatch = coord.match(/[1-8]/)

  if (!colMatch || !rowMatch) return { type: 'invalid' }

  const col = colMatch[0].charCodeAt(0) - 97
  const row = parseInt(rowMatch[0], 10) - 1

  return {
    type: isFlag ? 'flag' : 'reveal',
    row,
    col,
    coordLabel: `${colMatch[0].toUpperCase()}${rowMatch[0]}`
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

function buildComponents () {
  return []
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
      text: '8×8 Grid | Reveal: D1 or 1D | Flag: FD1 or 1DF | Reset: /minesweeper action:new'
    })
}

module.exports = {
  guildId: '160135882274373633',
  data: new SlashCommandBuilder()
    .setName('minesweeper')
    .setDescription('Play interactive Minesweeper in Discord')
    .addStringOption(opt =>
      opt.setName('action')
        .setDescription('Tile to reveal (D1 or 1D), flag (FD1 or 1DF), or reset. Leave empty to view board.')
        .setRequired(false)
    ),

  handleButton: async (interaction) => {
    const customId = interaction.customId
    const memKey = 'minesweeper.' + (interaction.channelId || 'dm')
    if (customId === 'minesweeper_new') {
      const game = newGame()
      const embed = buildEmbed(game, '🎮 Started a fresh Minesweeper game! Reveal a tile with `/minesweeper action:D1`')
      const components = buildComponents()
      const reply = await interaction.reply({ embeds: [embed], components, fetchReply: true }).catch(() => {})
      if (reply?.id) {
        game.messageId = reply.id
        await agentMemory.set(memKey, game, 30)
      }
    } else if (customId === 'minesweeper_help') {
      await interaction.reply({
        content: '📌 **Minesweeper Controls:**\n• **Reveal tile**: `/minesweeper action:D1` or `action:1D`\n• **Flag tile**: `/minesweeper action:FD1`, `action:1DF`, or `action:flag D1`\n• **New game**: `/minesweeper action:new`',
        ephemeral: true
      }).catch(() => {})
    }
  },

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
        notice = '🔄 Started a fresh game! Reveal a tile with `/minesweeper action:D1`'
        await agentMemory.set(memKey, game, 30)
      } else if (game.gameOver) {
        notice = '⚠️ Game is already over! Start a new game with `/minesweeper action:new`.'
      } else if (parsed.type === 'flag') {
        const { row, col, coordLabel } = parsed
        if (game.revealed[row][col]) {
          notice = `⚠️ Cannot flag **${coordLabel}** — it is already revealed.`
        } else {
          game.flagged[row][col] = !game.flagged[row][col]
          notice = game.flagged[row][col]
            ? `🚩 Flagged tile **${coordLabel}**.`
            : `🏳️ Unflagged tile **${coordLabel}**.`
          await agentMemory.set(memKey, game, 30)
        }
      } else if (parsed.type === 'reveal') {
        const { row, col, coordLabel } = parsed
        if (game.flagged[row][col]) {
          notice = `🚩 Tile **${coordLabel}** is flagged. Unflag it first with \`F${coordLabel}\`.`
        } else if (game.revealed[row][col]) {
          notice = `ℹ️ Tile **${coordLabel}** is already revealed.`
        } else {
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
          } else {
            floodReveal(game, row, col)
            checkWin(game)
          }
          await agentMemory.set(memKey, game, 30)
        }
      }
    } else if (game.gameOver) {
      game = newGame()
      isNewGame = true
      notice = '🎮 Started a fresh game! Reveal a tile with `/minesweeper action:D1`'
      await agentMemory.set(memKey, game, 30)
    }

    // Locate the active board message in this channel ONLY if continuing an existing game
    let boardMsg = null
    if (!isNewGame) {
      if (game.messageId && interaction.channel?.messages?.fetch) {
        boardMsg = await interaction.channel.messages.fetch(game.messageId).catch(() => null)
      }

      // Fallback: look for the most recent minesweeper message from the bot in this channel
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
    const components = buildComponents()

    if (!isNewGame && boardMsg) {
      // 1. Immediately acknowledge the slash command
      await interaction.deferReply().catch(() => {})

      // 2. Update the initial minesweeper message in place
      await boardMsg.edit({ embeds: [embed], components }).catch(err => {
        logger.error(`Failed to update minesweeper board message: ${err.message}`)
      })

      // 3. Delete the interacting slash command so the channel remains clean
      await interaction.deleteReply().catch(err => {
        logger.warn(`Failed to delete slash command interaction: ${err.message}`)
      })
    } else {
      // New game or no initial message found: post a new board message and track its ID
      const reply = await interaction.reply({ embeds: [embed], components, fetchReply: true })
      if (reply?.id) {
        game.messageId = reply.id
        await agentMemory.set(memKey, game, 30)
      }
    }
  }
}
