const publicIp = require("public-ip");

//Set List of commands
const commandList = ["help", "ping", "server"];

class Command {
	constructor(user, userID, channelID, message, cmd, evt) {
		(this.user = user),
			(this.userID = userID),
			(this.channelID = channelID),
			(this.cmd = cmd),
			(this.evt = evt),
			(this.message = message);
	}
	help(bot, logger) {
		const message =
			"Commands are " +
			commandList.map((e, index) =>
				index < commandList.length - 1 ? " !" + e : " and !" + e
			);
		bot.sendMessage({
			to: this.channelID,
			message: message
		});
	}
	ping(bot, logger) {
		bot.sendMessage({
			to: this.channelID,
			message: "Pong!"
		});
	}
	async serverIP(bot, logger) {
		const ip = await publicIp.v4();
		bot.sendMessage({
			to: this.channelID,
			message: ip
		});
	}
	info(bot, logger) {
		console.log(bot);
		// logger.info("evt:" + this.evt);
		logger.info("userID:" + this.userID);
		logger.info("user:" + this.user);
		logger.info("channelID:" + this.channelID);
		logger.info("message:" + this.message);
	}
}
exports.Command = Command;
