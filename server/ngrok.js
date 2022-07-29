const logger = require('../logger')
const ngrok = require('ngrok')
const port = process.env.TWITCH_LISTEN_PORT
const authtoken = process.env.NGROK_AUTH_TOKEN

const getURL = async () => {
    try {
            // await ngrok.disconnect()
            const url = await ngrok.connect({
            addr: port,
            authtoken
        })
        logger.info('Ngrok URL: ' + url)
        return url
    } catch (err) {
        console.error(err)
        logger.error('Ngrok Error: ' + err)
    }
}

module.exports = getURL