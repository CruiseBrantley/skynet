const NormalizedInteraction = require('../interfaces/NormalizedInteraction')

describe('NormalizedInteraction', () => {
  test('parses options across multiple types correctly', () => {
    const interaction = new NormalizedInteraction({
      clientId: 'test',
      commandName: 'weather',
      options: {
        location: 'Fayetteville',
        days: 5,
        celsius: 'false',
        rating: 4.8
      }
    })

    expect(interaction.options.getString('location')).toBe('Fayetteville')
    expect(interaction.options.getInteger('days')).toBe(5)
    expect(interaction.options.getBoolean('celsius')).toBe(false)
    expect(interaction.options.getNumber('rating')).toBe(4.8)
    expect(interaction.options.getString('nonexistent')).toBeNull()
  })

  test('delegates reply and deferReply to custom handlers', async () => {
    const mockReply = jest.fn().mockResolvedValue('replied')
    const mockDefer = jest.fn().mockResolvedValue('deferred')

    const interaction = new NormalizedInteraction({
      handlers: {
        reply: mockReply,
        deferReply: mockDefer
      }
    })

    await interaction.deferReply()
    expect(interaction.deferred).toBe(true)
    expect(mockDefer).toHaveBeenCalled()

    await interaction.reply({ content: 'Hello' })
    expect(interaction.replied).toBe(true)
    expect(mockReply).toHaveBeenCalledWith({ content: 'Hello' })
  })
})
