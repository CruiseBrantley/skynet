const inFlightChannels = new Set()

function markChannelInFlight (channelId) {
  if (channelId) inFlightChannels.add(channelId)
}

function clearChannelInFlight (channelId) {
  if (channelId) inFlightChannels.delete(channelId)
}

function isChannelInFlight (channelId) {
  return channelId ? inFlightChannels.has(channelId) : false
}

module.exports = {
  markChannelInFlight,
  clearChannelInFlight,
  isChannelInFlight
}
