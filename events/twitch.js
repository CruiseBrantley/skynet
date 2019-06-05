const { twitchClient, WebHookListener, bot } = require("../bot.js");
let listener;
let subscription;
WebHookListener.create(twitchClient, { port: 8090 }).then(async (res) => {
	listener = res;
	listener.listen();
	subscription = await listener.subscribeToStreamChanges(process.env.FIRERAVEN_ID, async (stream) => {
		if (stream) {
			bot.channels.get("579407168831225869").send(`${stream.userDisplayName} just went live: ${stream.title}`);
		} else {
			bot.channels.get("579407168831225869").send(`${stream.userDisplayName} just went offline.`);
		}
	});
});

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