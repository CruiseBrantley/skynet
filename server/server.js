const axios = require('axios')
const publicIp = require('public-ip')
const botAnnounce = require('../events/botAnnounce')
const logger = require('../logger')
const oauth = require('./oauth')
const express = require('express')
const server = express()
const port = process.env.TWITCH_LISTEN_PORT

server.use(express.json())

let streamID
let oauthToken
async function subscribe (id) {
  const data = {
    version: "1",
    type: "stream.online",
    "condition": {
      "broadcaster_user_id": id
    },
    "transport": {
      "method": "webhook",
      "callback": "https://9407-2600-1700-6750-5f3f-00-574.ngrok.io/",
      "secret": "abcdefghij0123456789"
    }
  }
  axios
    .post('https://api.twitch.tv/helix/eventsub/subscriptions', data, {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENTID,
        Authorization: `Bearer ${oauthToken}`,
        'Content-Type': 'application/json'
      }
    })
    .then(res =>
      logger.info('Successfully subscribed to Twitch Updates for ' + id)
    )
    .catch(err => {
      logger.info(`Failed Subscribing for ${id} ${err.message}`)
    })
}

async function subscribeAll () {
  oauthToken = await oauth()
  subscribe(process.env.FIRERAVEN_ID)
  subscribe(process.env.CYPHANE_ID)
  subscribe(process.env.CHA_ID)
  subscribe(process.env.SIRI4N_ID)
  subscribe(process.env.BFD_ID)
  subscribe(process.env.DALE_ID)
  subscribe(process.env.I_AM_JEFF_ID)
}

// function getGameInfo (id) {
//   return axios
//     .get(`https://api.twitch.tv/helix/games?id=${id}`, {
//       headers: {
//         'Client-ID': process.env.TWITCH_CLIENTID,
//         Authorization: `Bearer ${oauthToken}`
//       }
//     })
//     .then(res => {
//       if (res && res.data && res.data.data && res.data.data.length) {
//         const response = res.data.data[0]
//         logger.info(`Looked up data for: ${response.name}`)
//         return { game_name: response.name, game_image: response.box_art_url }
//       }
//       logger.info("Response wasn't right, or there was no game:\n ", res)
//     })
//     .catch(err => logger.info("Couldn't get game info: " + err))
// }

async function getGameInfo (id) {
  try {
    const res = await axios.get(`https://api.twitch.tv/helix/games?id=${id}`, {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENTID,
        Authorization: `Bearer ${oauthToken}`
      }
    })
    if (res && res.data && res.data.data && res.data.data.length) {
      const response = res.data.data[0]
      logger.info(`Looked up data for: ${response.name}`)
      return { game_name: response.name, game_image: response.box_art_url }
    }
    logger.info("Response wasn't right, or there was no game:\n ", res.data)
  }
  catch(err) {
    logger.info("Couldn't get game info: " + err)
  }
}

async function getChannelInfo (id) {
  try {
    const res = await axios.get(`https://api.twitch.tv/helix/channels?id=${id}`, {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENTID,
        Authorization: `Bearer ${oauthToken}`
      }
    })
    if (res && res.data && res.data.data && res.data.data.length) {
      return res.data.data[0]
      // logger.info(`Looked up data for: ${response.name}`)
      // return { game_name: response.name, game_image: response.box_art_url }
    }
    logger.info("Response wasn't right, or there was no user:\n ", res.data)
  }
  catch(err) {
    logger.info("Couldn't get channel info: " + err)
  }
}

function setupServer (bot) {
  subscribeAll()
  // this part may be unnecessary now
  // setInterval(() => {
  //   // Twitch times out subscriptions, this ensures they're renewed
  //   subscribeAll()
  // }, 86400 * 100) // s to ms

  server.get('/', async (req, res) => {
    // Called on initial subscription
    logger.info('Get: ' + req.query['hub.challenge'])
    res
      .status(200)
      .type('text/plain')
      .send(req.query['hub.challenge'])
  })

  server.post('/', async (req, res) => {
    // Called when new stream is detected
    // streamID is kept to ensure there aren't duplicate updates
    logger.info('Post Received.')
    const { body } = req
    console.log(body)

    if (body.challenge) {
      // Called on initial subscription
      logger.info('Challenge Token: ' + body.challenge)
      res
        .status(200)
        .type('text/plain')
        .send(body.challenge)
    }

    else if (
      body &&
      body.subscription &&
      body.subscription.id !== streamID
    ) {
      const response = await getChannelInfo(body.event.broadcaster_user_id)
      console.log('channel info response:', response)
      const gameInfo = await getGameInfo(response.game_id)
      const betterResponse = { ...response, ...gameInfo }
      botAnnounce(bot, betterResponse)
      streamID = betterResponse.id
    }
  })

  server.listen(port, () =>
    logger.info(`Twitch updates listening on port: ${port}!`)
  )
  return server
}

module.exports = setupServer
