const axios = require('axios')
const publicIp = require('public-ip')
const bodyParser = require('body-parser')
const { botAnnounce } = require("../events/botAnnounce");
const { logger } = require("../bot")
const express = require('express')
const server = express()
const port = process.env.TWITCH_LISTEN_PORT

server.use(bodyParser.json())

let streamID

async function subscribe(id) {
	const data = {
		'hub.callback': `http://${await publicIp.v4()}:${port}/`,
		'hub.mode': 'subscribe',
		'hub.lease_seconds': 86400,
		'hub.topic': `https://api.twitch.tv/helix/streams?user_id=${id}`
	}
	axios.post('https://api.twitch.tv/helix/webhooks/hub', data, { headers: { 'Client-ID': process.env.TWITCH_CLIENTID } })
		.then(res => logger.info('Successfully subscribed to Twitch Updates for ' + id))
		.catch(err => logger.info(err))
}

function subscribeAll() {
	subscribe(process.env.FIRERAVEN_ID)
	subscribe(process.env.CYPHANE_ID)
	subscribe(process.env.CHA_ID)
}

module.exports.server = function setupServer(bot) {
	subscribeAll()
	setInterval(() => {
		subscribeAll()
	}, 8640000)

	server.get('/', async (req, res) => {
		logger.info("Get: " + req.query['hub.challenge'])
		res.status(200).type('text/plain').send(req.query['hub.challenge'])
	})

	server.post('/', async (req, res) => {
		logger.info("Post: " + req.body)
		if (req.body && req.body.data && req.body.data.length > 0 && req.body.data[0].id !== streamID) {
			botAnnounce(bot, req.body.data[0].user_name, req.body.data[0].title)
			streamID = req.body.data[0].id
		}
		res.status(200).type('text/plain').send(req.query['hub.challenge'])
	})

	server.listen(port, () => logger.info(`Twitch updates listening on port: ${port}!`))
	return server
}