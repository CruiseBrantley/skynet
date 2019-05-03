const publicIp = require("public-ip");
const axios = require("axios");
const fs = require("fs");
const { bot, logger } = require("../bot.js");
const { topicFile, trackNewTopic } = require("../events/twitter.js");

//Set List of commands
const commandList = [
	"help",
	"ping",
	"server",
	"say",
	"note",
	"listnotes",
	"twitter",
	"catfact"
];

class Command {
	constructor(message, cmd, args) {
		this.message = message;
		this.cmd = cmd;
		this.args = args;
	}
	help() {
		//ex: !help
		const message =
			"Commands are " +
			commandList.map((e, index) =>
				index < commandList.length - 1 ? " `!" + e + "`" : " and `!" + e + "`"
			);
		this.message.channel.send(message);
	}
	async ping() {
		//ex: !ping
		const m = await this.message.channel.send("Ping?");
		m.edit(
			`Pong! Bot response latency is ${m.createdTimestamp -
				this.message.createdTimestamp}ms. API Latency is ${Math.round(
				bot.ping
			)}ms`
		);
	}
	async server() {
		this.message.channel.send(
			`The current server ip address is: ${await publicIp.v4()}`
		);
	}
	say() {
		//ex: !say I'm telling the bot what to say.
		const sayMessage = this.args.join(" ");
		this.message.delete().catch(() => {
			logger.info(
				"Encountered an error while deleting: " + this.message.content
			);
		});
		this.message.channel.send(sayMessage);
	}
	note() {
		//ex: !note title="New Title" Here is the content.
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
				process.env.NOTESPOST,
				{ title, text },
				{
					headers: {
						username: process.env.NOTESUSER,
						password: process.env.NOTESPASS
					}
				}
			)
			.then(response => {
				this.message.channel.send(
					"I've added your note. You can view them with !listnotes or online at https://cruise-notes.firebaseapp.com/ login with `Cruise-bot` `Whatpassword?`"
				);
			})
			.catch(err => {
				console.log(err);
			});
	}
	listnotes() {
		//ex: !listnotes
		axios
			.get(process.env.NOTESPOST, {
				headers: {
					username: process.env.NOTESUSER,
					password: process.env.NOTESPASS
				}
			})
			.then(response => {
				if (response.data.notes.length === 0) {
					this.message.channel.send(
						'There aren\'t currently any notes, you could change this with `!note title="New Title" The new note.`'
					);
					return;
				}
				let newMessage = "```Current Notes:";
				for (let note of response.data.notes) {
					note.title === "Untitled"
						? (newMessage += "\n" + note.text)
						: (newMessage += "\n" + note.title + ": " + note.text);
				}
				this.message.channel.send(newMessage + "```");
			})
			.catch(error => {
				console.log(error);
			});
	}
	twitter() {
		//ex: !twitter Tesla Model 3
		const newTopic = this.args.join(" ");
		topicFile.topic = newTopic;
		fs.writeFile(
			process.env.TOPIC_FILENAME,
			JSON.stringify(topicFile, null, 2),
			err => {
				if (err) return console.log(err);
				trackNewTopic(newTopic);
				console.log(JSON.stringify(topicFile));
				console.log(`Wrote "${newTopic}" to ${process.env.TOPIC_FILENAME}`);
			}
		);
	}
	catfact() {
		//ex: !catfact
		axios
			.get(process.env.CATFACT_GET)
			.then(response => {
				this.message.channel.send(response.data.fact);
			})
			.catch(error => {
				console.log(error);
			});
	}
}
module.exports.Command = Command;
