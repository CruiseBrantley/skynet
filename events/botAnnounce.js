const { logger, bot } = require("../bot");

function botAnnounce() {
	return () => {
		try {
			bot.channels.get("579407168831225869").send("@everyone Fireraven just went live! https://www.twitch.tv/fire_raven");
		} catch (err) {
			logger.info("botAnnounce error: ", err);
		}
	};
}
exports.botAnnounce = botAnnounce;
