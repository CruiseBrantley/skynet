const publicIp = require("public-ip");

//Set List of commands
const commandList = ["help", "ping", "server", "say", "division"];

class Command {
	constructor(bot, logger, message, cmd, args) {
		this.bot = bot;
		this.logger = logger;
		this.message = message;
		this.cmd = cmd;
		this.args = args;
	}
	help() {
		const message =
			"Commands are " +
			commandList.map((e, index) =>
				index < commandList.length - 1 ? " `!" + e + "`" : " and `!" + e + "`"
			);
		this.message.channel.send(message);
	}
	async ping() {
		const m = await this.message.channel.send("Ping?");
		m.edit(
			`Pong! Latency is ${m.createdTimestamp -
				this.message.createdTimestamp}ms. API Latency is ${Math.round(
				this.bot.ping
			)}ms`
		);
	}
	async server() {
		this.message.channel.send(
			`The current server ip address is: ${await publicIp.v4()}`
		);
	}
	say() {
		const sayMessage = this.args.join(" ");
		this.message.delete().catch(() => {});
		this.message.channel.send(sayMessage);
	}
}
exports.Command = Command;
