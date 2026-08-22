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
const processedMessageIds = new Set()
const MESSAGE_ID_CACHE_SIZE = 1000

async function twitchSubscribe (id, url, twitchToken) {
  const data = {
    version: '1',
    type: 'stream.online',
    condition: {
      broadcaster_user_id: id
    },
    transport: {
      method: 'webhook',
      callback: await url,
      secret: 'abcdefghij0123456789'
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

async function deleteSubscription (subscriptionId) {
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
    })
    .catch(err => {
      logger.info('Failed Getting Subscriptions:', err)
    })
}

async function subscribeAll () {
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
  } catch (err) {
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
  } catch (err) {
    logger.info("Couldn't get channel info: " + err)
  }
}

function setupServer (bot) {
  subscribeAll()

  server.get(['/', '/twitch'], async (req, res) => {
    logger.info('Get: ' + req.query['hub.challenge'])
    res
      .status(200)
      .type('text/plain')
      .send(req.query['hub.challenge'])
  })

  server.post(['/', '/twitch'], async (req, res) => {
    const messageId = req.headers['twitch-eventsub-message-id']

    // 1. Strict Webhook Deduplication (Twitch Retries)
    if (messageId) {
      if (processedMessageIds.has(messageId)) {
        logger.info(`Webhook Deduplicated: ${messageId}`)
        return res.status(200).send('Deduplicated')
      }
      processedMessageIds.add(messageId)
      // Prune cache if it gets too large
      if (processedMessageIds.size > MESSAGE_ID_CACHE_SIZE) {
        const firstValue = processedMessageIds.values().next().value
        processedMessageIds.delete(firstValue)
      }
    }

    logger.info('Post Received.')
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
      body.event &&
      body.subscription.id !== streamID
    ) {
      const response = await getChannelInfo(body.event.broadcaster_user_id)
      if (!response) {
        return res.status(500).send('Failed to get channel info')
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

  const serverInstance = server.listen(port, () =>
    logger.info(`Twitch updates listening on port: ${port}!`)
  )

  if (serverInstance && typeof serverInstance.on === 'function') {
    serverInstance.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`Port ${port} is already in use. Web server failed to start, but bot will continue.`)
      } else {
        logger.error(`Web server error: ${err.message}`)
      }
    })
  }

  // HTTP endpoint to refresh Twitch EventSub subscriptions (updates ngrok tunnel)
  server.get('/refresh-subscriptions', async (req, res) => {
    logger.info('Manual subscription refresh requested via HTTP')
    res.status(202).send('Subscription refresh started')
    subscribeAll().catch(err => logger.error('Error during subscription refresh:', err))
  })

  // Perform a delayed health check after startup (give Twitch 10s to verify webhooks)
  setTimeout(() => {
    checkTwitchHealth(bot).catch(err => logger.warn(`Initial Twitch health check failed: ${err.message}`))
  }, 10_000).unref()

  // Return the express app for tests/introspection; callers don't use the return today.
  return server
}

/**
 * Checks the health of all active Twitch EventSub subscriptions and alerts the bot owner via Discord DM if issues are found.
 * @param {import('discord.js').Client} bot
 * @returns {Promise<{ healthy: boolean, failedSubs: object[], total: number }>}
 */
async function checkTwitchHealth (bot) {
  try {
    const token = oauthToken || await oauth()
    const subs = await getSubscriptions(token)
    if (!subs || !subs.data) {
      return { healthy: false, failedSubs: [], total: 0 }
    }

    const failedSubs = subs.data.filter(s => s.status === 'webhook_callback_verification_failed' || s.status.includes('failed'))
    const healthy = failedSubs.length === 0

    if (!healthy && bot && process.env.OWNER_ID) {
      try {
        const owner = await bot.users.fetch(process.env.OWNER_ID).catch(() => null)
        if (owner) {
          const sampleFailure = failedSubs[0]
          const alertMsg = `⚠️ **Twitch Ingress Alert**: ${failedSubs.length}/${subs.data.length} Twitch EventSub subscriptions failed webhook callback verification.\n` +
            `**Target Callback**: \`${sampleFailure.transport?.callback || 'unknown'}\`\n` +
            `**Status**: \`${sampleFailure.status}\`\n\n` +
            '💡 **Likely Cause**: The SSL/TLS certificate for your DDNS domain expired or the port forwarding/reverse proxy is unreachable.\n' +
            'Use `/twitch-notify sync` once resolved, or comment out `TWITCH_CALLBACK_URL` in `.env` to fallback to Ngrok.'
          await owner.send(alertMsg).catch(e => logger.warn(`Could not send DM alert to owner: ${e.message}`))
        }
      } catch (alertErr) {
        logger.warn(`Failed to dispatch Twitch health alert DM: ${alertErr.message}`)
      }
    }

    logger.info(`Twitch Health Check: ${subs.data.length - failedSubs.length}/${subs.data.length} subscriptions healthy.`)
    return { healthy, failedSubs, total: subs.data.length }
  } catch (err) {
    logger.error(`Error in checkTwitchHealth: ${err.message}`)
    return { healthy: false, failedSubs: [], total: 0 }
  }
}

module.exports.setupServer = setupServer
module.exports.getSubscriptions = getSubscriptions
module.exports.deleteSubscription = deleteSubscription
module.exports.twitchSubscribe = twitchSubscribe
module.exports.subscribeAll = subscribeAll
module.exports.checkTwitchHealth = checkTwitchHealth
