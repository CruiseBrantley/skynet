const ytdl = require('ytdl-core-discord')

module.exports = async function playVideo (url, connection, volume) {
  return connection.play(await ytdl(url, { highWaterMark: 1 << 25 }), {
    type: 'opus',
    volume: volume / 10,
    passes: 2
  })
}