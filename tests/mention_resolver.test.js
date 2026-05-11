const fs = require('fs')
const mentionResolver = require('../util/MentionResolver')

jest.mock('../logger')
jest.mock('fs')

describe('MentionResolver', () => {
  const guildId = '123456789'

  beforeEach(() => {
    jest.clearAllMocks()
    mentionResolver.mentionMap = {}
  })

  test('should record and resolve mentions', () => {
    mentionResolver.record('sirian', '12345', guildId)
    const text = 'Hello @sirian'
    const resolved = mentionResolver.resolve(text, guildId)
    expect(resolved).toBe('Hello <@12345>')
  })

  test('should handle case insensitivity', () => {
    mentionResolver.record('Sirian', '12345', guildId)
    const text = 'Hello @sirian and @SIRIAN'
    const resolved = mentionResolver.resolve(text, guildId)
    expect(resolved).toBe('Hello <@12345> and <@12345>')
  })

  test('should prioritize longer names to avoid partial matches', () => {
    mentionResolver.record('cruise', '1', guildId)
    mentionResolver.record('cruisebrantley', '2', guildId)

    const text = 'Hello @cruisebrantley and @cruise'
    const resolved = mentionResolver.resolve(text, guildId)

    expect(resolved).toBe('Hello <@2> and <@1>')
  })

  test('should not resolve partial word matches', () => {
    mentionResolver.record('sirian', '12345', guildId)
    const text = 'Hello @sirian_test'
    const resolved = mentionResolver.resolve(text, guildId)
    expect(resolved).toBe('Hello @sirian_test')
  })

  test('should record nicknames with spaces and resolve them', () => {
    mentionResolver.record('Cruise Brantley', '101', guildId)
    const text = 'Paging @Cruise Brantley for help'
    const resolved = mentionResolver.resolve(text, guildId)
    expect(resolved).toBe('Paging <@101> for help')
  })

  test('should skip recording if duplicate', () => {
    const writeSpy = jest.spyOn(fs, 'writeFileSync')
    mentionResolver.record('sirian', '12345', guildId) // First write
    mentionResolver.record('sirian', '12345', guildId) // Duplicate, should not write

    // Initial load might have called write or record, so we check the count since restart
    // In our beforeEach we cleared mocks, so it should be exactly 1
    expect(writeSpy).toHaveBeenCalledTimes(1)
  })

  test('should not resolve mentions from a different guild', () => {
    mentionResolver.record('sirian', '12345', guildId)
    const text = 'Hello @sirian'
    const resolved = mentionResolver.resolve(text, 'different_guild')
    expect(resolved).toBe('Hello @sirian')
  })
})
