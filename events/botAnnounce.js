const { logger } = require("../bot");

async function botAnnounce(bot, data) {
	try {
		bot.channels.get(process.env.ANNOUNCE_CHANNEL).send(
			`@everyone ${data.user_name} has gone Live! https://www.twitch.tv/${data.user_name}`,
			{
				embed: {
					author: {
						name: `${data.user_name} is Streaming on Twitch!`
					},
					url: `https://www.twitch.tv/${data.user_name}`,
					title: data.title,
					image: {
						url: data.thumbnail_url.replace(`{width}`, '1025').replace('{height}', '577')
					},
					timestamp: data.started_at
				}
			});
	} catch (err) {
		logger.info("botAnnounce error: ", err);
	}
}
exports.botAnnounce = botAnnounce;
