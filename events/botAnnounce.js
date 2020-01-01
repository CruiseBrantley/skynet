const fetch = require('snekfetch');
const { logger } = require("../bot");
const fs = require('fs')

async function botAnnounce(bot, data) {
	let image = await fetch.get(data.game_image
		? data.game_image.replace(`{width}`, '900').replace('{height}', '1200')
		: data.thumbnail_url.replace(`{width}`, '1025').replace('{height}', '577'))

	fs.writeFileSync('image.jpg', image.body, 'binary')

	try {
		bot.channels.get(process.env.TEST_CHANNEL).send(
			`@everyone ${data.user_name} has gone Live! https://www.twitch.tv/${data.user_name}`,
			{
				embed: {
					author: {
						name: `${data.user_name} is Streaming ${data.game_name ? `${data.game_name} ` : ''}on Twitch!`
					},
					url: `https://www.twitch.tv/${data.user_name}`,
					title: data.title,
					image: {
						url: 'attachment://image.jpg'
					},
					timestamp: data.started_at
				}, files: [{ attachment: 'image.jpg', name: 'image.jpg' }]
			});
	} catch (err) {
		logger.info("botAnnounce error: ", err);
	}
}
exports.botAnnounce = botAnnounce;
