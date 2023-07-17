const { getVoiceConnection, createAudioPlayer, createAudioResource, StreamType } = require('@discordjs/voice');
const ytdl = require('ytdl-core-discord')

module.exports = async function playVideo (url, id, volume) {
  const connection = await getVoiceConnection(id)
  const player = createAudioPlayer();
  const stream = await ytdl(url, {
    type: 'opus',
    quality: 'highestaudio',
    highWaterMark: 1 << 25
  })
  const options = {
    inputType: StreamType.Opus,
    // inlineVolume: true
  }
  const resource = createAudioResource(stream, options)
  // resource.volume.setVolume(volume / 10)
  await player.play(resource)
  return subscription = await connection.subscribe(player)
}