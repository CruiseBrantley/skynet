const {twitchClient} = require("../bot.js");

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