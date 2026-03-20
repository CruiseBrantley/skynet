const dotenv = require('dotenv')
dotenv.config()
const logger = require('../logger')
const ngrok = require('@ngrok/ngrok')
const port = process.env.TWITCH_LISTEN_PORT
const authtoken = process.env.NGROK_AUTH_TOKEN
const subdomain = process.env.NGROK_SUBDOMAIN

const getURL = async () => {
    try {
            const listener = await ngrok.connect({
                addr: port,
                authtoken
            })
            const url = listener.url()
            logger.info('Ngrok URL: ' + url)
            return url
    } catch (err) {
        console.error(err)
        logger.error('Ngrok Error: ' + err)
    }
}

module.exports = getURL