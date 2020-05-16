const axios = require('axios')
const publicIp = require('public-ip')
const bodyParser = require('body-parser')
const botAnnounce = require("../events/botAnnounce")
const logger = require("../logger")
const oauth = require('./oauth')
const express = require('express')
const server = express()
const port = process.env.NODE_ENV === 'dev' ? 3001 : process.env.TWITCH_LISTEN_PORT
console.log(port)

server.use(bodyParser.json())

let streamID

async function subscribe(id, oauthToken) {
	const data = {
		'hub.callback': `http://${await publicIp.v4()}:${port}/`,
		'hub.mode': 'subscribe',
		'hub.lease_seconds': 86400,
		'hub.topic': `https://api.twitch.tv/helix/streams?user_id=${id}`
	}
	axios.post('https://api.twitch.tv/helix/webhooks/hub', data, { headers: { 'Client-ID': process.env.TWITCH_CLIENTID, 'Authorization': `Bearer ${oauthToken}` } })
		.then(res => logger.info('Successfully subscribed to Twitch Updates for ' + id))
		.catch(err => logger.info('Failed Subscribing for' + id))
}

async function subscribeAll() {
	const oauthToken = await oauth()
	subscribe(process.env.FIRERAVEN_ID, oauthToken)
	subscribe(process.env.CYPHANE_ID, oauthToken)
	subscribe(process.env.CHA_ID, oauthToken)
	subscribe(process.env.SIRI4N_ID, oauthToken)
	subscribe(process.env.BFD_ID, oauthToken)
}

async function getGameInfo(id) {
	return axios.get(`https://api.twitch.tv/helix/games?id=${id}`, { headers: { 'Client-ID': process.env.TWITCH_CLIENTID } })
		.then(res => {
			if (res && res.data && res.data.data && res.data.data.length) {
				const response = res.data.data[0]
				logger.info(`Looked up data for: ${response.name}`)
				return { game_name: response.name, game_image: response.box_art_url }
			}
			logger.info("Response wasn't right, or there was no game:\n ", res)
		})
		.catch(err => logger.info("Couldn't get game info: " + err))
}

function setupServer(bot) {
	subscribeAll()
	setInterval(() => {
		// Twitch times out subscriptions, this ensures they're renewed
		subscribeAll()
	}, 86400 * 100) // s to ms

	server.get('/', async (req, res) => {
		// Called on initial subscription
		logger.info("Get: " + req.query['hub.challenge'])
		res.status(200).type('text/plain').send(req.query['hub.challenge'])
	})

	server.post('/', async (req, res) => {
		// Called when new stream is detected
		// streamID is kept to ensure there aren't duplicate updates
		logger.info("Post Received.")
		if (req.body && req.body.data && req.body.data.length > 0 && req.body.data[0].id !== streamID) {
			const response = req.body.data[0]
			const gameInfo = await getGameInfo(response.game_id)
			const betterResponse = { ...response, ...gameInfo }
			botAnnounce(bot, betterResponse)
			streamID = betterResponse.id
		}
		res.status(200).type('text/plain').send(req.query['hub.challenge'])
	})

	server.listen(port, () => logger.info(`Twitch updates listening on port: ${port}!`))
	return server
}

module.exports = setupServer
