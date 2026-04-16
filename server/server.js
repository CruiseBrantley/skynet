const axios = require('axios')
const botAnnounce = require('../events/botAnnounce')
const logger = require('../logger')
const oauth = require('./oauth')
const express = require('express')
const getURL = require('./ngrok')
const fs = require('fs')
const path = require('path')

const server = express()
const port = process.env.TWITCH_LISTEN_PORT
const configPath = path.join(__dirname, '../config/announcements.json')

server.use(express.json())

let streamID
let oauthToken
const processedMessageIds = new Set();
const MESSAGE_ID_CACHE_SIZE = 1000;

async function twitchSubscribe(id, url, twitchToken) {
  const data = {
    version: "1",
    type: "stream.online",
    "condition": {
      "broadcaster_user_id": id
    },
    transport: {
      method: "webhook",
      callback: await url,
      secret: "abcdefghij0123456789"
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
      logger.info(`Failed Subscribing for ${id}: ${err.response?.data?.message || err.message}`)
      return err.response?.data
    })
}

async function deleteSubscription(subscriptionId) {
  return axios
    .delete(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${subscriptionId}`, {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENTID,
        Authorization: `Bearer ${oauthToken}`
      }
    })
    .then(res =>
      logger.info('Successfully deleted Twitch subscription: ' + subscriptionId)
    )
    .catch(err => {
      logger.info(`Failed deleting subscription ${subscriptionId}: ${err.message}`)
    })
}

async function getSubscriptions(oauthParam) {
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
    })
    .catch(err => {
      logger.info('Failed Getting Subscriptions:', err)
    })
}

async function subscribeAll() {
  try {
    const url = await getURL()
    oauthToken = await oauth()

    // Clean up old subscriptions to prevent accumulation
    const existingSubs = await getSubscriptions(oauthToken)
    if (existingSubs && existingSubs.data && existingSubs.data.length > 0) {
      logger.info(`Cleaning up ${existingSubs.data.length} old Twitch subscriptions...`)
      for (const sub of existingSubs.data) {
        await deleteSubscription(sub.id)
      }
    }

    // Load unique streamers from config
    const configData = fs.readFileSync(configPath, 'utf8')
    const config = JSON.parse(configData)
    const uniqueStreamers = new Set()
    
    config.groups.forEach(group => {
      group.streamers.forEach(id => uniqueStreamers.add(id))
    })

    logger.info(`Subscribing to ${uniqueStreamers.size} unique Twitch streamers...`)
    for (const id of uniqueStreamers) {
      await twitchSubscribe(id, url)
    }
  } catch (err) {
    logger.error('Error in subscribeAll:', err)
  }
}

async function getGameInfo(id) {
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
  } catch (err) {
    logger.info("Couldn't get game info: " + err)
  }
}

async function getChannelInfo(id) {
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
  } catch (err) {
    logger.info("Couldn't get channel info: " + err)
  }
}

function setupServer(bot) {
  subscribeAll()

  server.get('/', async (req, res) => {
    logger.info('Get: ' + req.query['hub.challenge'])
    res
      .status(200)
      .type('text/plain')
      .send(req.query['hub.challenge'])
  })

  server.post('/', async (req, res) => {
    const messageId = req.headers['twitch-eventsub-message-id'];
    
    // 1. Strict Webhook Deduplication (Twitch Retries)
    if (messageId) {
      if (processedMessageIds.has(messageId)) {
        logger.info(`Webhook Deduplicated: ${messageId}`);
        return res.status(200).send('Deduplicated');
      }
      processedMessageIds.add(messageId);
      // Prune cache if it gets too large
      if (processedMessageIds.size > MESSAGE_ID_CACHE_SIZE) {
        const firstValue = processedMessageIds.values().next().value;
        processedMessageIds.delete(firstValue);
      }
    }

    logger.info('Post Received.');
    const { body } = req

    if (body.challenge) {
      logger.info('Challenge Token: ' + body.challenge)
      res
        .status(200)
        .type('text/plain')
        .send(body.challenge)
    } else if (
      body &&
      body.subscription &&
      body.subscription.id !== streamID
    ) {
      const response = await getChannelInfo(body.event.broadcaster_user_id)
      if (!response) {
        return res.status(500).send('Failed to get channel info');
      }
      const gameInfo = await getGameInfo(response.game_id)
      const betterResponse = { ...response, ...gameInfo }
      botAnnounce(bot, betterResponse)
      streamID = body.subscription.id
      res.status(200).send('OK')
    } else {
      res.status(200).send('OK')
    }
  })

  server.listen(port, () =>
    logger.info(`Twitch updates listening on port: ${port}!`)
  )
  return server
}

module.exports.setupServer = setupServer
module.exports.getSubscriptions = getSubscriptions
module.exports.deleteSubscription = deleteSubscription
module.exports.twitchSubscribe = twitchSubscribe
module.exports.subscribeAll = subscribeAll;
