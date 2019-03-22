const publicIp = require("public-ip");

//Set List of commands
const commandList = ["help", "ping", "server"];

class Command {
	constructor(user, userID, channelID, cmd, evt) {
		(this.user = user),
			(this.userID = userID),
			(this.channelID = channelID),
			(this.cmd = cmd),
			(this.evt = evt);
	}
	help() {
		const { bot } = require("./bot");
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
	ping() {
		const { bot } = require("./bot");
		bot.sendMessage({
			to: this.channelID,
			message: "Pong!"
		});
	}
	async serverIP() {
		const { bot } = require("./bot");
		const ip = await publicIp.v4();
		bot.sendMessage({
			to: this.channelID,
			message: ip
		});
	}
}
exports.Command = Command;
