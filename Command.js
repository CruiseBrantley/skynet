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
	help(bot) {
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
	ping(bot) {
		bot.sendMessage({
			to: this.channelID,
			message: "Pong!"
		});
	}
	async serverIP(bot) {
		const ip = await publicIp.v4();
		bot.sendMessage({
			to: this.channelID,
			message: ip
		});
	}
	info(bot) {
		console.log("bot:", bot);
		console.log("evt:", this.evt);
		console.log("userID:", this.userID);
		console.log("user:", this.user);
		console.log("channelID:", this.channelID);
		console.log("message:", this.message);
	}
}
exports.Command = Command;
