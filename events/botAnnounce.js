const { logger } = require("../bot");
const { bot } = require("../bot.js");

function botAnnounce() {
	return () => {
		try {
			bot.channels.get("579407168831225869").send("@everyone Stream starting now! https://www.twitch.tv/fire_raven");
		} catch (err) {
			logger.info("botAnnounce error: ", err);
		}
	};
}
exports.botAnnounce = botAnnounce;
