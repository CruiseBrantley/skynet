const { twitchClient, bot, logger } = require("../bot.js");
const WebHookListener = require('twitch-webhooks').default;
const userId = process.env.FIRERAVEN_ID;

const listenerInit = async () => {
	listener = await WebHookListener.create(twitchClient, { port: 8090 });
	listener.listen();
	return subscription(listener);
}

const subscription = async (listener) => {
	return await listener.subscribeToStreamChanges(userId, async (stream) => {
		if (stream) {
			bot.channels.get("579407168831225869").send(`${stream.userDisplayName} just went live: ${stream.title}`);
		} else {
			// no stream, no display name
			const user = await twitchClient.helix.users.getUserById(userId);
			bot.channels.get("579407168831225869").send(`${user.displayName} just went offline.`);
		}
	});
}

listenerInit().then(res => { })
	.catch((err) => logger.info("listenerErr: ", err))

class Twitch {
	constructor() { }
	async isStreamLive(userName) {
		const user = await twitchClient.kraken.users.getUserByName(userName);
		if (!user) {
			return false;
		}
		return await twitchClient.kraken.streams.getStreamByChannel(user.id) !== null;
	}
	async streamProperties(userName) {
		const user = await twitchClient.kraken.users.getUserByName(userName);
		if (!user) {
			return false;
		}
		return await twitchClient.kraken.streams.getStreamByChannel(user.id);
	}
}

module.exports.Twitch = Twitch;