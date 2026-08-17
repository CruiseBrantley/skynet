// Auto-generated slash command: roll
// Updated with ASCII dice art rendering

const { SlashCommandBuilder } = require('discord.js')

const D6_FACES = {
  1: ['+-------+', '|       |', '|   o   |', '|       |', '+-------+'],
  2: ['+-------+', '| o     |', '|       |', '|     o |', '+-------+'],
  3: ['+-------+', '| o     |', '|   o   |', '|     o |', '+-------+'],
  4: ['+-------+', '| o   o |', '|       |', '| o   o |', '+-------+'],
  5: ['+-------+', '| o   o |', '|   o   |', '| o   o |', '+-------+'],
  6: ['+-------+', '| o   o |', '| o   o |', '| o   o |', '+-------+']
}

function renderD6Ascii (rolls) {
  if (rolls.length === 0 || rolls.length > 6) return ''
  const faces = rolls.map(r => D6_FACES[r] || ['+---+', `| ${r} |`, '+---+'])
  const lines = []
  for (let row = 0; row < 5; row++) {
    lines.push(faces.map(f => f[row] || '').join('  '))
  }
  return '```\n' + lines.join('\n') + '\n```'
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice with a standard formula (e.g. 2d6+3, 1d20, 4d6)')
    .addStringOption(opt => opt.setName('formula').setDescription('Dice formula (e.g. 2d6+3, 1d20, 4d6)').setRequired(true)),
  execute: async (interaction) => {
    const formula = interaction.options.getString('formula', true)
    const match = formula.match(/^(\d+)d(\d+)([+-]\d+)?$/i)
    if (!match) {
      await interaction.reply('Invalid formula. Use format: XdY or XdY+Z (e.g. 2d6+3, 1d20)')
      return
    }
    const count = parseInt(match[1])
    const sides = parseInt(match[2])
    const mod = match[3] ? parseInt(match[3]) : 0

    if (count < 1 || count > 50) {
      await interaction.reply('Dice count must be between 1 and 50.')
      return
    }
    if (sides < 2 || sides > 1000) {
      await interaction.reply('Dice sides must be between 2 and 1000.')
      return
    }

    const rolls = []
    let total = 0
    for (let i = 0; i < count; i++) {
      const r = Math.floor(Math.random() * sides) + 1
      rolls.push(r)
      total += r
    }
    total += mod
    const rollStr = rolls.join(', ')
    const modStr = mod !== 0 ? ` ${mod > 0 ? '+' : ''}${mod}` : ''

    let asciiBlock = ''
    if (sides === 6 && count <= 6) {
      asciiBlock = '\n' + renderD6Ascii(rolls)
    }

    await interaction.reply(`🎲 **${formula}** → [${rollStr}]${modStr} = **${total}**${asciiBlock}`)
  }
}
