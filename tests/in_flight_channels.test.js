const { markChannelInFlight, clearChannelInFlight, isChannelInFlight } = require('../util/inFlightChannels')

describe('inFlightChannels Locking Mechanism', () => {
  test('marks channel in flight and clears it correctly', () => {
    const channelId = '123456789'

    expect(isChannelInFlight(channelId)).toBe(false)

    markChannelInFlight(channelId)
    expect(isChannelInFlight(channelId)).toBe(true)

    clearChannelInFlight(channelId)
    expect(isChannelInFlight(channelId)).toBe(false)
  })

  test('handles null or undefined channelId gracefully', () => {
    expect(isChannelInFlight(null)).toBe(false)
    expect(isChannelInFlight(undefined)).toBe(false)

    markChannelInFlight(null)
    expect(isChannelInFlight(null)).toBe(false)

    clearChannelInFlight(undefined)
    expect(isChannelInFlight(undefined)).toBe(false)
  })
})
