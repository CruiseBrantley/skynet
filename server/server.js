const axios = require('axios')
const botAnnounce = require('../events/botAnnounce')
const logger = require('../logger')
const oauth = require('./oauth')
const express = require('express')
const getURL = require('./ngrok')
const server = express()
const port = process.env.TWITCH_LISTEN_PORT

server.use(express.json())

let streamID
let oauthToken

async function twitchSubscribe (id, url, twitchToken) {
  const data = {
    version: "1",
    type: "stream.online",
    "condition": {
      "broadcaster_user_id": id
    },
    "transport": {
      "method": "webhook",
      "callback": await url,
      "secret": "abcdefghij0123456789"
    }
  }
  return axios
    .post('https://api.twitch.tv/helix/eventsub/subscriptions', data, {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENTID,
        Authorization: `Bearer ${twitchToken || oauthToken}`,
        'Content-Type': 'application/json'
      }
    })
    .then(res => {
      logger.info('Successfully subscribed to Twitch Updates for ' + id)
      return res.status
    })
    .catch(err => {
      logger.info(`Failed Subscribing for ${id} ${err.message}`)
      return err.response?.data
    })
}
async function deleteSubscription (id, url) {
  console.log('URL is:', url)
  const data = {
    version: "1",
    type: "stream.online",
    "condition": {
      "broadcaster_user_id": id
    },
    "transport": {
      "method": "webhook",
      "callback": url,
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

async function getSubscriptions (oauthParam) {
  return axios
    .get('https://api.twitch.tv/helix/eventsub/subscriptions', {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENTID,
        Authorization: `Bearer ${oauthParam || oauthToken}`,
        'Content-Type': 'application/json'
      }
    })
    .then(res => {
      logger.info(`Successfully got all ${String(res.data?.total)} Subscriptions`)
      return res.data
    }
    )
    .catch(err => {
      logger.info('Failed Getting Subscriptions:', err)
    })
}

async function subscribeAll () {
  const url = getURL()
  oauthToken = await oauth()
  twitchSubscribe(process.env.FIRERAVEN_ID, url)
  twitchSubscribe(process.env.CYPHANE_ID, url)
  twitchSubscribe(process.env.CHA_ID, url)
  twitchSubscribe(process.env.SIRI4N_ID, url)
  twitchSubscribe(process.env.BFD_ID, url)
  twitchSubscribe(process.env.DALE_ID, url)
  twitchSubscribe(process.env.I_AM_JEFF_ID, url)
  twitchSubscribe(process.env.WHITEHALLOW_ID, url)
  twitchSubscribe(process.env.DEKU_ID, url)
  twitchSubscribe(process.env.HOSKI_ID, url)
  twitchSubscribe(process.env.CROW_ID, url)
  twitchSubscribe(process.env.MERC_ID, url)
  twitchSubscribe(process.env.JUAN_ID, url)
}

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
    const res = await axios.get(`https://api.twitch.tv/helix/channels?broadcaster_id=${id}`, {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENTID,
        Authorization: `Bearer ${oauthToken}`
      }
    })
    if (res && res.data && res.data.data && res.data.data.length) {
      return res.data.data[0]
    }
    logger.info("Response wasn't right, or there was no channel:\n ", res.data)
  }
  catch(err) {
    logger.info("Couldn't get channel info: " + err)
  }
}

function setupServer (bot) {
  subscribeAll()
  setInterval(() => {
    // ngrok URL needs to be renewed periodically
    subscribeAll()
  }, 60 * 60 * 24 * 100) // seconds/minutes/hours/day/milliseconds

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
      const gameInfo = await getGameInfo(response.game_id)
      const betterResponse = { ...response, ...gameInfo }
      botAnnounce(bot, betterResponse)
      streamID = body.subscription.id
    }
  })

  server.listen(port, () =>
    logger.info(`Twitch updates listening on port: ${port}!`)
  )
  return server
}

function testServer () {
  server.get('/', async (req, res) => {
    // Called on initial subscription
    console.log('Get: ' + req.query['hub.challenge'])
    res
      .status(200)
      .type('text/plain')
      .send(req.query['hub.challenge'])
  })

  server.listen(5002, () =>
    logger.info(`Twitch updates listening on port: ${5002}!`)
  )
  return server
}

module.exports.setupServer = setupServer
module.exports.getSubscriptions = getSubscriptions
module.exports.deleteSubscription = deleteSubscription
module.exports.twitchSubscribe = twitchSubscribe
module.exports.testServer = testServer
