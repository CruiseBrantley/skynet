const fetch = require('snekfetch')
const logger = require('../logger')
const fs = require('fs')

const fireraven = process.env.FIRERAVEN_ID
const cyphane = process.env.CYPHANE_ID
const cha = process.env.CHA_ID
const bfd = process.env.BFD_ID

const cyphaneFriends = [fireraven, cha, bfd]
const fireFriends = [cyphane, cha]

const streamCases = [
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
  } // Case Cyphane Friend
] // ToDo: Maybe I should rewrite as Switch Statement

function mainAnnounce (bot, data, channel) {
  try {
    bot.channels
      .get(channel)
      .send(
        `@everyone ${data.user_name} has gone Live! https://www.twitch.tv/${data.user_name}`,
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

function friendAnnounce (bot, data, channel) {
  try {
    bot.channels
      .get(channel)
      .send(
        `${data.user_name} has gone Live! https://www.twitch.tv/${data.user_name}`,
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
    logger.info('Friend botAnnounce error: ', err)
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

    for (const streamCase of streamCases) {
      if (
        streamCase.type === 'main' &&
        streamCase.case.includes(data.user_id)
      ) {
        mainAnnounce(bot, data, streamCase.channel)
      } else if (
        streamCase.type === 'friend' &&
        streamCase.case.includes(data.user_id)
      ) {
        friendAnnounce(bot, data, streamCase.channel)
      }
    }
  } catch (err) {
    logger.info('Error downloading image', err)
  }
}
module.exports = botAnnounce
