const fetch = require('snekfetch');
const { logger } = require("../bot");
const fs = require('fs')

const fireraven = process.env.FIRERAVEN_ID
const cyphane = process.env.CYPHANE_ID
const cha = process.env.CHA_ID
const bfd = process.env.BFD_ID

const cyphaneFriends = [fireraven, cha, bfd]
const fireFriends = [cyphane, cha]

const streamCases = [
	{ case: fireraven, channel: process.env.FIRERAVEN_ANNOUNCE_CHANNEL }, 		//Case FireRaven
	{ case: fireFriends, channel: process.env.FIRERAVEN_FRIENDS_ANNOUNCE_CHANNEL },	//Case FireRaven Friend
	{ case: cyphane, channel: process.env.CYPHANE_ANNOUNCE_CHANNEL },				//Case Cyphane
	{ case: cyphaneFriends, channel: process.env.CYPHANE_FRIENDS_ANNOUNCE_CHANNEL },//Case Cyphane Friend
]																					//ToDo: Maybe I should rewrite as Switch Statement

async function botAnnounce(bot, data) {
	try {
		let image = await fetch.get(data.game_image
			? data.game_image.replace(`{width}`, '900').replace('{height}', '1200')
			: data.thumbnail_url.replace(`{width}`, '1025').replace('{height}', '577'))

		fs.writeFileSync('image.jpg', image.body, 'binary')

		for (const streamCase of streamCases) {
			if (streamCase.case === data.user_id) mainAnnounce(streamCase.channel)
			else if (typeof streamCase.case === array && streamCase.case.includes(data.user_id)) friendAnnounce(streamCase.channel)
		}

		function mainAnnounce(channel) {
			try {
				bot.channels.get(channel).send(
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
				logger.info("Main botAnnounce error: ", err);
			}
		}

		function friendAnnounce(channel) {
			try {
				bot.channels.get(channel).send(
					`${data.user_name} has gone Live! https://www.twitch.tv/${data.user_name}`,
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
				logger.info("Friend botAnnounce error: ", err);
			}
		}
	} catch (err) {
		logger.info("Error downloading image", err)
	}
}
exports.botAnnounce = botAnnounce;
