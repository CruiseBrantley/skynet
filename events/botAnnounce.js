const { logger } = require("../bot");

async function botAnnounce(bot, userName, title) {
	try {
		bot.channels.get(process.env.TEST_CHANNEL).send(`@everyone ${userName} just went live! ${title} https://www.twitch.tv/${userName}`);
	} catch (err) {
		logger.info("botAnnounce error: ", err);
	}
}
exports.botAnnounce = botAnnounce;
