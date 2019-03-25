const publicIp = require("public-ip");
const axios = require("axios");

//Set List of commands
const commandList = ["help", "ping", "server", "say", "note"];

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
			`Pong! Bot response latency is ${m.createdTimestamp -
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
		this.message.delete().catch(() => {
			this.logger.info(
				"Encountered an error while deleting: " + this.message.content
			);
		});
		this.message.channel.send(sayMessage);
	}
	note() {
		let title = "Untitled";
		let text;

		text = this.args.join(" ");
		if (text.substring(0, 7).toLowerCase() === 'title="') {
			const textIndex = text.indexOf('"', 8) + 2;
			title = text.substring(7, textIndex - 2);
			text = text.substring(textIndex);
		}

		axios
			.post(
				process.env.TESTPOST,
				{ title, text },
				{
					headers: {
						username: process.env.NOTESUSER,
						password: process.env.NOTESPASS
					}
				}
			)
			.then(response => {
				if (response) console.log(response.data);
				else console.log("Something went wrong.");
			})
			.catch(err => {
				console.log(err);
			});
	}
}
exports.Command = Command;
