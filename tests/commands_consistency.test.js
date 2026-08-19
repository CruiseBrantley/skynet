const fs = require('fs')
const path = require('path')

describe('Command Consistency', () => {
  const commandsPath = path.join(__dirname, '../commands')
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'))

  test('all commands using MessageFlags must import it from discord.js', () => {
    commandFiles.forEach(file => {
      const filePath = path.join(commandsPath, file)
      const content = fs.readFileSync(filePath, 'utf8')

      if (content.includes('MessageFlags')) {
        // Check if MessageFlags is in the require('discord.js') line
        const discordImportMatch = content.match(/const\s+\{([^}]*)\}\s*=\s*require\(['"]discord\.js['"]\)/)
        if (discordImportMatch) {
          const imports = discordImportMatch[1].split(',').map(i => i.trim())
          if (!imports.includes('MessageFlags')) {
            throw new Error(`File ${file} uses MessageFlags but does not import it from discord.js`)
          }
        } else {
          // Maybe it's imported differently? Let's check for any mention of require('discord.js')
          if (!content.includes("require('discord.js')") && !content.includes('require("discord.js")')) {
            throw new Error(`File ${file} uses MessageFlags but does not seem to import discord.js at all`)
          }
        }
      }
    })
  })

  test('all commands have data and execute properties and pass Discord schema validation', () => {
    commandFiles.forEach(file => {
      const filePath = path.join(commandsPath, file)
      const command = require(filePath)

      expect(command).toHaveProperty('data')
      expect(command).toHaveProperty('execute')
      expect(typeof command.execute).toBe('function')

      // Validate Discord slash command schema
      const json = typeof command.data?.toJSON === 'function' ? command.data.toJSON() : command.data
      expect(json).toBeDefined()
      expect(json.name).toBeDefined()
      expect(json.name).toMatch(/^[a-z0-9_-]{1,32}$/)
      expect(json.description).toBeDefined()
      expect(json.description.length).toBeGreaterThan(0)
      expect(json.description.length).toBeLessThanOrEqual(100)

      if (json.options) {
        expect(Array.isArray(json.options)).toBe(true)
        expect(json.options.length).toBeLessThanOrEqual(25)
        json.options.forEach(opt => {
          expect(opt.name).toMatch(/^[a-z0-9_-]{1,32}$/)
          expect(opt.description.length).toBeGreaterThan(0)
          expect(opt.description.length).toBeLessThanOrEqual(100)
        })
      }
    })
  })

  test('SafeEmbedBuilder automatically enforces Discord limits without throwing errors', () => {
    const { SafeEmbedBuilder } = require('../util/discordFormatter')

    const hugeTitle = 'A'.repeat(500)
    const hugeDesc = 'B'.repeat(8000)
    const hugeFieldName = 'C'.repeat(400)
    const hugeFieldValue = 'D'.repeat(3000)
    const hugeFooter = 'E'.repeat(4000)
    const hugeAuthor = 'F'.repeat(400)

    const embed = new SafeEmbedBuilder()
      .setTitle(hugeTitle)
      .setDescription(hugeDesc)
      .addFields({ name: hugeFieldName, value: hugeFieldValue })
      .setFooter({ text: hugeFooter })
      .setAuthor({ name: hugeAuthor })

    const data = embed.data
    expect(data.title.length).toBeLessThanOrEqual(256)
    expect(data.description.length).toBeLessThanOrEqual(4096)
    expect(data.fields[0].name.length).toBeLessThanOrEqual(256)
    expect(data.fields[0].value.length).toBeLessThanOrEqual(1024)
    expect(data.footer.text.length).toBeLessThanOrEqual(2048)
    expect(data.author.name.length).toBeLessThanOrEqual(256)
  })

  test('SafeEmbedBuilder converts markdown tables in descriptions cleanly', () => {
    const { SafeEmbedBuilder } = require('../util/discordFormatter')

    const tableMarkdown = `
| Item | Price |
|---|---|
| Sword | 100g |
| Shield | 50g |
`
    const embed = new SafeEmbedBuilder().setDescription(tableMarkdown)
    expect(embed.data.description).not.toContain('|---|---|')
    expect(embed.data.description).toContain('**Item**: Sword')
  })
})
