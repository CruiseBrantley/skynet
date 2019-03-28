const { logger } = require("../bot");
function botDelete() {
	return message => {
		// if (message.author.bot) return; //ignore bots
		if (message != undefined) {
			logger.info(
				`${message.author.username}'s message was deleted: "${message.content}"`
			);
		}
	};
}
exports.botDelete = botDelete;
