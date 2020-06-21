const fetch = require('snekfetch')
const logger = require('../logger')
const fs = require('fs')

const fireraven = process.env.FIRERAVEN_ID
const cyphane = process.env.CYPHANE_ID
const cha = process.env.CHA_ID
const bfd = process.env.BFD_ID
const dale = process.env.DALE_ID
const siri4n = process.env.SIRI4N_ID

const cyphaneFriends = [fireraven, cha, bfd]
const fireFriends = [cyphane, cha]
const siri4nFriends = [siri4n]

const prodCases = [
  {
    case: [fireraven],
    channel: process.env.FIRERAVEN_ANNOUNCE_CHANNEL,
    type: 'main'
  }, // Case FireRaven
  {
    case: fireFriends,
    channel: process.env.FIRERAVEN_FRIENDS_ANNOUNCE_CHANNEL,
    type: 'friend'
  }, // Case FireRaven Friend
  {
    case: [cyphane],
    channel: process.env.CYPHANE_ANNOUNCE_CHANNEL,
    type: 'main'
  }, // Case Cyphane
  {
    case: cyphaneFriends,
    channel: process.env.CYPHANE_FRIENDS_ANNOUNCE_CHANNEL,
    type: 'friend'
  }, // Case Cyphane Friend
  {
    case: [dale],
    channel: process.env.DALE_ANNOUNCE_CHANNEL,
    type: 'main'
  } // Case Dale
]

const testCases = [
  {
    case: [siri4n],
    channel: process.env.TEST_CHANNEL,
    type: 'main'
  },
  {
    case: siri4nFriends,
    channel: process.env.TEST_CHANNEL,
    type: 'friend'
  }
]

const streamCases = process.env.NODE_ENV === 'dev' ? testCases : prodCases

function announce (bot, data, channel, type) {
  try {
    bot.channels
      .get(channel)
      .send(
        `${type === 'friend' ? '' : '@everyone'} ${
          data.user_name
        } has gone Live! https://www.twitch.tv/${data.user_name}`,
        {
          embed: {
            author: {
              name: `${data.user_name} is Streaming ${
                data.game_name ? `${data.game_name} ` : ''
              }on Twitch!`
            },
            url: `https://www.twitch.tv/${data.user_name}`,
            title: data.title,
            image: {
              url: 'attachment://image.jpg'
            },
            timestamp: data.started_at
          },
          files: [{ attachment: 'image.jpg', name: 'image.jpg' }]
        }
      )
  } catch (err) {
    logger.info('Main botAnnounce error: ', err)
  }
}

async function botAnnounce (bot, data) {
  try {
    const image = await fetch.get(
      data.game_image
        ? data.game_image.replace('{width}', '900').replace('{height}', '1200')
        : data.thumbnail_url
            .replace('{width}', '1025')
            .replace('{height}', '577')
    )

    fs.writeFileSync('image.jpg', image.body, 'binary')

    for (const streamCase of streamCases)
      if (streamCase.case.includes(data.user_id)) {
        announce(bot, data, streamCase.channel, streamCase.type)
      }
  } catch (err) {
    logger.info('Error downloading image', err)
  }
}
module.exports = botAnnounce
