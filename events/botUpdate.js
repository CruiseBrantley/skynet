function botUpdate(logger) {
	return (originalMessage, updatedMessage) => {
		if (originalMessage.author.bot) return; //ignore bots
		if (originalMessage != undefined) {
			logger.info(
				"User " +
					originalMessage.author.username +
					' updated: "' +
					originalMessage.content +
					'" to "' +
					updatedMessage.content +
					'"'
			);
		}
	};
}
exports.botUpdate = botUpdate;
