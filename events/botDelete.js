function botDelete(logger) {
	return message => {
		if (message.author.bot) return; //ignore bots
		if (message != undefined) {
			logger.info(
				`User ${message.author.username} deleted: "${message.content}"`
			);
		}
	};
}
exports.botDelete = botDelete;
