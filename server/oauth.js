const axios = require('axios')
const logger = require('../logger')
const dotenv = require("dotenv");
dotenv.config();

module.exports = function getOAuthToken() {
	return axios.post(`https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENTID}&client_secret=${process.env.TWITCH_SECRET}&grant_type=client_credentials`)
		.then(res => {
			logger.info('Successfully grabbed OAuth Token ' + res.data.access_token)
			return res.data.access_token
		})
		.catch(err => logger.info('Failed getting OAuth Token', err))
}