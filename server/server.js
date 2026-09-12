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

function setupServer (coreOrBot, database) {
  const bot = coreOrBot?.client || coreOrBot?.getClient?.('discord')?.client || coreOrBot
  const db = database || coreOrBot?.database
  subscribeAll()

  // Serve Static Web UI Assets from public/
  const publicDir = path.join(__dirname, '../public')
  if (typeof express.static === 'function') {
    server.use(express.static(publicDir))
    server.use('/chat', express.static(publicDir))
  }

  // Web Chat Interface Routes
  server.get(['/', '/chat', '/chat/'], (req, res, next) => {
    // If Twitch sends challenge on root /, delegate to Twitch challenge handler
    if (req.query && (req.query['hub.challenge'] || req.query.challenge)) {
      return next()
    }
    res.sendFile(path.join(publicDir, 'index.html'))
  })

  const authManager = require('./auth/AuthManager')

  // Auth: List configured OAuth providers (GET /api/chat/auth/providers & GET /api/auth/providers)
  server.get(['/api/chat/auth/providers', '/api/auth/providers'], (req, res) => {
    const providers = authManager.listConfiguredProviders()
    res.status(200).json({ success: true, providers })
  })

  // Auth: Current Session State (GET /api/chat/auth/me & GET /api/auth/me)
  server.get(['/api/chat/auth/me', '/api/auth/me'], (req, res) => {
    const session = authManager.resolveSession(req)
    if (session) {
      res.status(200).json({
        authenticated: true,
        user: {
          id: session.userId,
          profileId: session.profileId,
          username: session.username,
          displayName: session.displayName,
          avatar: session.avatar,
          isOwner: session.isOwner
        }
      })
    } else {
      res.status(200).json({ authenticated: false, user: null })
    }
  })

  // Auth: Logout (POST /api/chat/auth/logout & POST /api/auth/logout)
  server.post(['/api/chat/auth/logout', '/api/auth/logout'], (req, res) => {
    res.setHeader('Set-Cookie', 'skynet_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
    res.status(200).json({ success: true, message: 'Logged out successfully.' })
  })

  // Auth: Initiate OAuth Login (GET /api/chat/auth/:provider/login & GET /api/auth/:provider/login)
  server.get(['/api/chat/auth/:provider/login', '/api/auth/:provider/login'], (req, res) => {
    const providerName = req.params.provider
    const provider = authManager.getProvider(providerName)

    if (!provider || !provider.isConfigured()) {
      return res.status(400).send(`OAuth provider "${providerName}" is not configured or enabled.`)
    }

    // Determine public callback URL based on host (using /api/chat/auth/:provider/callback for lighttpd proxy compatibility)
    const host = req.get('host') || 'localhost:3000'
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http'
    const redirectUri = `${proto}://${host}/api/chat/auth/${providerName}/callback`

    const state = Math.random().toString(36).substring(2) + Date.now().toString(36)
    const authUrl = provider.getAuthorizationUrl(state, redirectUri)
    res.redirect(authUrl)
  })

  // Auth: OAuth Callback (GET /api/chat/auth/:provider/callback & GET /api/auth/:provider/callback)
  server.get(['/api/chat/auth/:provider/callback', '/api/auth/:provider/callback'], async (req, res) => {
    const providerName = req.params.provider
    const { code } = req.query

    if (!code) {
      return res.status(400).send('Missing authorization code from OAuth provider.')
    }

    const provider = authManager.getProvider(providerName)
    if (!provider) {
      return res.status(400).send(`Unknown OAuth provider "${providerName}".`)
    }

    try {
      const host = req.get('host') || 'localhost:3000'
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http'
      const redirectUri = `${proto}://${host}/api/chat/auth/${providerName}/callback`

      const profile = await provider.handleCallback(code, redirectUri)
      const user = authManager.upsertUser(profile)
      const token = authManager.createSessionToken(user)

      // Set session cookie (30 days) and redirect to /chat
      res.setHeader('Set-Cookie', `skynet_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`)
      res.redirect('/chat')
    } catch (err) {
      logger.error(`OAuth Callback Error for "${providerName}": ${err.message}`)
      res.status(500).send(`Authentication failed: ${err.message}`)
    }
  })

  // MyAnimeList OAuth Routes
  server.get(['/mal/login', '/api/mal/login'], (req, res) => {
    try {
      const malClient = require('../util/malClient')
      const authUrl = malClient.getAuthUrl()
      res.redirect(authUrl)
    } catch (err) {
      res.status(500).send(`Failed to generate MAL auth URL: ${err.message}`)
    }
  })

  server.get(['/mal/callback', '/api/mal/callback'], async (req, res) => {
    const { code, error, message } = req.query
    if (error || message) {
      return res.status(400).send(`MyAnimeList OAuth error: ${error || message}`)
    }
    if (!code) {
      return res.status(400).send('Missing authorization code from MyAnimeList.')
    }

    try {
      const malClient = require('../util/malClient')
      await malClient.handleCallback(code)
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Skynet - MyAnimeList Connected</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 2.5rem; border-radius: 1rem; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; max-width: 450px; border: 1px solid #334155; }
            h1 { color: #38bdf8; margin-bottom: 0.5rem; }
            p { color: #94a3b8; line-height: 1.6; }
            .badge { display: inline-block; background: #0284c7; color: white; padding: 0.25rem 0.75rem; border-radius: 9999px; font-weight: 600; font-size: 0.875rem; margin-top: 1rem; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>✅ MyAnimeList Connected</h1>
            <p>Skynet has successfully authenticated with your MyAnimeList account. The bot can now programmatically add, update, and manage your watchlist from Discord!</p>
            <div class="badge">You can close this tab</div>
          </div>
        </body>
        </html>
      `)
    } catch (err) {
      logger.error(`MAL Callback Error: ${err.message}`)
      res.status(500).send(`Authentication failed: ${err.message}`)
    }
  })

  // Conversation History Endpoint (GET /api/conversations/history)
  server.get('/api/conversations/history', async (req, res) => {
    const conversationStore = require('../core/conversationStore')
    const session = authManager.resolveSession(req)

    let profile = 'guest_session'
    let discordUserId = null

    if (session) {
      profile = session.profileId || (session.isOwner ? 'sirian' : `user_${session.userId}`)
      // Check if session has a Discord identity
      const fullUser = authManager.getUser(session.userId)
      const discordIdentity = fullUser?.identities?.find(i => i.provider === 'discord')
      if (discordIdentity) {
        discordUserId = discordIdentity.id
      } else if (session.isOwner) {
        discordUserId = process.env.OWNER_ID
      }
    } else if (req.query.profile && req.query.profile !== 'sirian') {
      // Allow guests/custom non-owner queries
      profile = req.query.profile
    }

    // Sync latest messages from Discord DM if Discord client is active
    if (discordUserId && profile) {
      try {
        const discordAdapter = coreOrBot?.getClient?.('discord') || (coreOrBot?.id === 'discord' ? coreOrBot : null)
        if (discordAdapter?.client?.users) {
          const user = await discordAdapter.client.users.fetch(discordUserId).catch(() => null)
          const dm = user ? (user.dmChannel || await user.createDM().catch(() => null)) : null
          if (dm) {
            await conversationStore.syncFromDiscord(profile, dm, discordAdapter.client.user?.id, 30)
          }
        }
      } catch (err) {
        logger.warn(`Server history sync warning for profile ${profile}: ${err.message}`)
      }
    }

    const limit = parseInt(req.query.limit, 10) || 30
    const history = conversationStore.getHistory(profile, limit)
    res.status(200).json({ success: true, profile, history })
  })

  server.get(['/', '/twitch'], async (req, res) => {
    logger.info('Get: ' + (req.query['hub.challenge'] || req.query.challenge))
    res
      .status(200)
      .type('text/plain')
      .send(req.query['hub.challenge'] || req.query.challenge)
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
      botAnnounce(bot, betterResponse, db)
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

  // Generic Webhook Receiver for external services (e.g. POST /api/webhook/github_alerts)
  server.post('/api/webhook/:id', async (req, res) => {
    const webhookId = req.params.id
    const payload = req.body || {}
    logger.info(`Server: Received external webhook POST on /api/webhook/${webhookId}`)

    try {
      const triggerEngine = require('../util/TriggerEngine')
      const result = await triggerEngine.evaluateWebhook(webhookId, payload, bot)
      res.status(200).json({ success: true, webhookId, matchedTriggers: result?.matched || 0 })
    } catch (err) {
      logger.error(`Server: Error processing webhook /api/webhook/${webhookId}: ${err.message}`)
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Direct Web & CLI API Chat Endpoint (POST /api/chat)
  server.post('/api/chat', async (req, res) => {
    const { message, user_id: requestedUserId, stream = false, author = null } = req.body || {}
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Missing required field "message".' })
    }

    const conversationStore = require('../core/conversationStore')
    const { getBasePrompt } = require('../util/systemPrompt')
    const AgentTurnManager = require('../util/chat/AgentTurnManager')
    const NormalizedInteraction = require('../interfaces/NormalizedInteraction')
    const ollama = require('../util/ollama')

    const botName = process.env.BOT_NAME || 'Skynet'
    const session = authManager.resolveSession(req)

    let userId = null
    let authorName = 'User'
    let isOwner = false
    let profileId = 'guest_session'
    let heartbeat = null

    if (session) {
      userId = session.userId
      authorName = session.displayName || session.username || 'User'
      isOwner = Boolean(
        session.isOwner ||
        userId === process.env.OWNER_ID ||
        session.username?.toLowerCase() === 'sirian' ||
        session.displayName?.toLowerCase() === 'sirian'
      )
      if (isOwner && !userId) userId = process.env.OWNER_ID
      profileId = session.profileId || (isOwner ? 'sirian' : `user_${userId}`)
    } else {
      // Unauthenticated / Localhost / CLI direct invocation fallback
      const isLocalhost = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1' || req.hostname === 'localhost'
      if (requestedUserId && (requestedUserId === process.env.OWNER_ID || requestedUserId === 'cli_owner' || requestedUserId.toLowerCase() === 'sirian')) {
        userId = process.env.OWNER_ID
        isOwner = true
        profileId = 'sirian'
        authorName = author || process.env.OWNER_NAME || 'Sirian'
      } else if (author && author.toLowerCase() === 'sirian') {
        userId = process.env.OWNER_ID
        isOwner = true
        profileId = 'sirian'
        authorName = 'Sirian'
      } else if (isLocalhost) {
        // Local machine browser connection defaults to bot owner
        userId = process.env.OWNER_ID
        isOwner = true
        profileId = 'sirian'
        authorName = author || 'Sirian'
      } else if (requestedUserId) {
        userId = requestedUserId
        isOwner = false
        profileId = `user_${requestedUserId}`
        authorName = author || requestedUserId
      } else {
        // Guest user session
        profileId = 'guest_session'
        authorName = author || 'Guest'
      }
    }

    try {
      // Hydrate local context
      const promptOptions = { isOwner, isDM: true, guildId: null, userId: isOwner ? process.env.OWNER_ID : userId }
      const storedHistory = conversationStore.getHistory(profileId, 20)
      const channelHistory = {
        messages: [
          { role: 'system', content: getBasePrompt(promptOptions) },
          ...storedHistory.map(m => ({
            role: m.role || 'user',
            content: m.author ? `@${m.author}: ${m.content}` : m.content
          })),
          { role: 'user', content: `@${authorName}: ${message}` }
        ]
      }

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache, no-transform')
        res.setHeader('Connection', 'keep-alive')
        res.setHeader('X-Accel-Buffering', 'no') // Disable proxy buffering (Nginx, Lighttpd)
        res.flushHeaders?.()
      }

      const { createStatusHeartbeat } = require('../util/chat/statusHeartbeat')

      heartbeat = null
      const interaction = new NormalizedInteraction({
        clientId: 'web',
        user: { id: isOwner ? process.env.OWNER_ID : (userId || 'guest_user'), username: authorName },
        channel: { id: `web_${profileId}`, name: `web_${profileId}` },
        isOwner,
        isDM: true,
        profileId
      })
      interaction.isOwner = isOwner
      interaction.isDM = true
      interaction.profileId = profileId

      if (stream) {
        interaction.streamToken = (token) => {
          if (heartbeat) {
            heartbeat.stop()
            heartbeat = null
          }
          res.write(`data: ${JSON.stringify({ token })}\n\n`)
          if (typeof res.flush === 'function') res.flush()
        }

        interaction.showStatus = async (text) => {
          if (!heartbeat) {
            heartbeat = createStatusHeartbeat(async (payload) => {
              const statusText = typeof payload === 'string' ? payload : (payload.content || '')
              res.write(`data: ${JSON.stringify({ status: statusText })}\n\n`)
              if (typeof res.flush === 'function') res.flush()
            }, text)
            await heartbeat.start()
          } else {
            await heartbeat.updateStatus(text)
          }
        }
      }

      if (stream && typeof interaction.showStatus === 'function') {
        await interaction.showStatus(`${botName} is thinking...`).catch(() => {})
      }

      const turnManager = new AgentTurnManager({ botName, queryOllamaWithContext: ollama.queryOllamaWithContext })
      const turnResult = await turnManager.executeTurn({
        interaction,
        database: db,
        channelHistory,
        ollamaContext: {
          userId: isOwner ? process.env.OWNER_ID : userId,
          isOwner,
          guildId: null
        },
        maxSteps: 25
      })

      // Persist turn to conversationStore
      conversationStore.appendMessage(profileId, {
        role: 'user',
        content: message,
        author: authorName,
        source: 'web',
        timestamp: Date.now()
      })

      if (turnResult?.replyContent) {
        conversationStore.appendMessage(profileId, {
          role: 'assistant',
          content: turnResult.replyContent,
          author: botName,
          source: 'local',
          timestamp: Date.now()
        })
      }

      // Mirror turn to Discord DM for user context if Discord adapter is available
      if (turnResult?.replyContent) {
        let discordTargetId = null
        if (session) {
          const fullUser = authManager.getUser(session.userId)
          const discordIdentity = fullUser?.identities?.find(i => i.provider === 'discord')
          if (discordIdentity) {
            discordTargetId = discordIdentity.id
          } else if (session.isOwner) {
            discordTargetId = process.env.OWNER_ID
          }
        } else if (isOwner) {
          discordTargetId = process.env.OWNER_ID
        }

        if (discordTargetId) {
          const discordAdapter = coreOrBot?.getClient?.('discord') ||
            (coreOrBot?.id === 'discord' ? coreOrBot : null)
          if (discordAdapter && typeof discordAdapter.mirrorWebTurnToUser === 'function') {
            discordAdapter.mirrorWebTurnToUser(discordTargetId, message, turnResult.replyContent, turnResult.executedTools)
              .catch(e => logger.warn(`Server: Failed to mirror web turn to Discord: ${e.message}`))
          }
        }
      }

      if (stream) {
        res.write(`data: ${JSON.stringify({ done: true, replyContent: turnResult?.replyContent || '' })}\n\n`)
        return res.end()
      } else {
        return res.status(200).json({
          success: true,
          profileId,
          replyContent: turnResult?.replyContent || '',
          executedTools: turnResult?.executedTools || []
        })
      }
    } catch (err) {
      logger.error(`Server: Error on /api/chat: ${err.message}`)
      if (stream) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
        return res.end()
      }
      return res.status(500).json({ success: false, error: err.message })
    } finally {
      if (heartbeat) {
        heartbeat.stop()
        heartbeat = null
      }
    }
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
