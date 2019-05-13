const publicIp = require("public-ip");
const axios = require("axios");
const googleTTS = require("google-tts-api");
const ytdl = require("ytdl-core");
const youtubeSearch = require("youtube-search");
const fs = require("fs");
const { logger } = require("../bot.js");
const { topicFile, trackNewTopic } = require("../events/twitter.js");
let dispatcher = {};
let volume = 5;

//Set List of commands
const commandList = [
	"help",
	"speak",
	"speakchannel",
	"search",
	"youtube",
	"volume",
	"stop",
	"pause",
	"resume",
	"ping",
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

	stop() {
		if (dispatcher !== {}) {
			dispatcher.destroy();
			this.message.member.voice.channel.leave();
		}
	}

	pause() {
		if (dispatcher !== {}) {
			dispatcher.pause();
		}
	}

	resume() {
		if (dispatcher !== {}) {
			dispatcher.resume();
		}
	}

	volume() {
		if (this.args.length === 0) {
			this.message.channel.send(`The current volume is set to ${volume}.`);
			return;
		}

		if (!(this.args[0] >= 0 && this.args[0] <= 2)) {
			this.message.channel.send("The Volume must be between 0 and 20 (default is 5).");
			return;
		}
		volume = this.args.shift();
		dispatcher.setVolume(volume / 10);
		this.message.channel.send(`Setting current volume to ${volume}.`);
		return;
	}

	speak() {
		//ex: !speak The words to be said in my voice channel
		const speakMessage = this.args.join(" ");
		if (!speakMessage.length) {
			this.message.channel.send("I need a message to speak!");
			return;
		}
		if (speakMessage.length > 200) {
			//Google translate API has a 200 character limitation
			this.message.channel.send(
				`I can only speak up to 200 characters at a time, you entered ${
				speakMessage.length
				}.`
			);
			return;
		}
		googleTTS(speakMessage, "en", 1).then(url => {
			this.message.member.voice.channel
				.join()
				.then(connection => {
					dispatcher = connection.play(url);
					dispatcher.on("end", () => {
						this.message.member.voice.channel.leave();
					});
				})
				.catch(err => logger.info("Encountered an error: ", err));
		});
	}

	speakchannel() {
		//ex: !sc General The words to be said in General voice channel
		const channelName = this.args.shift();
		const speakMessage = this.args.join(" ");
		if (!speakMessage.length) {
			this.message.channel.send("I need a message to speak!");
			return;
		}
		if (speakMessage.length > 200) {
			//Google translate API has a 200 character limitation
			this.message.channel.send(
				`I can only speak up to 200 characters at a time, you entered ${
				speakMessage.length
				}.`
			);
			return;
		}
		googleTTS(speakMessage, "en", 1).then(url => {
			const channel = this.message.guild.channels.find(item => {
				return (
					item.name.toLowerCase() === channelName.toLowerCase() &&
					item.type === "voice"
				);
			});
			if (channel === undefined || null) {
				this.message.channel.send(
					"Hmmm, it seems I couldn't find that channel."
				);
				return;
			}
			channel
				.join()
				.then(connection => {
					dispatcher = connection.play(url);

					/////////////////////workaround code//////////////////////////////
					let i = 0;														//
					while (!dispatcher.player.streamingData.sequence && i < 10) {	//
						if (i === 0) logger.info("Reached Workaround");				//
						dispatcher = connection.play(url);							//
						i++;														//
					}																//
					if (i >= 10) {													//
						logger.info("Timing out.");									//
						channel.leave();											//
					}																//
					/////////////////////workaround code//////////////////////////////

					dispatcher.on("end", () => {
						channel.leave();
					});
				}).catch(err => logger.info("channel join error: ", err));
		}).catch(err => logger.info("googleTTS error: ", err));
	}

	searchyoutube() {
		//ex: !searchyoutube The query goes here
		const query = this.args.join(" ");
		const opts = {
			maxResults: 3,
			key: process.env.YOUTUBE_KEY,
			type: "video"
		};

		youtubeSearch(query, opts, (err, results) => {
			if (err) return logger.info("youtubeSearch error: ", err);
			results.forEach(result => {
				this.message.channel.send({
					embed: {
						"author": {
							"name": result.channelTitle,
						},
						"title": result.title,
						"description": result.description,
						"url": result.link,
						"color": 2116863,
						"timestamp": result.publishedAt,
						"thumbnail": {
							"url": result.thumbnails.default.url
						}, "footer": {
							"text": "!yt " + result.link
						}
					}
				})
			})
		})
	}

	youtube() {
		//ex: !playyoutube videoURL
		//ex: !playyoutube channel videoURL
		let channelName;
		let channel;
		if (this.args.length < 1) {
			this.message.channel.send("You can to optionally supply a channel name, but a video URL is required.");
			return;
		}
		if (this.args.length < 2) {
			channel = this.message.member.voice.channel;
		} else {
			channelName = this.args.shift();

			channel = this.message.guild.channels.find(item => {
				return (
					item.name.toLowerCase() === channelName.toLowerCase() &&
					item.type === "voice"
				);
			});
			if (channel === undefined || null) {
				this.message.channel.send(
					"Hmmm, it seems I couldn't find that channel."
				);
				return;
			}
		}
		const url = this.args.shift();
		channel
			.join()
			.then(connection => {
				dispatcher = connection.play(ytdl(url, { filter: "audioonly", quality: 'highestaudio' }), { volume: volume / 10 });

				/////////////////////workaround code//////////////////////////////
				let i = 0;														//
				while (!dispatcher.player.streamingData.sequence && i < 10) {	//
					if (i === 0) logger.info("Reached Workaround");				//
					dispatcher = connection.play(url);							//
					i++;														//
				}																//
				if (i >= 10) {													//
					logger.info("Timing out.");									//
					channel.leave();											//
				}																//
				/////////////////////workaround code//////////////////////////////

				dispatcher.on("end", () => {
					channel.leave();
				});
			}).catch(err => logger.info("channel join error: ", err));
	}

	async ping() {
		//ex: !ping
		const m = await this.message.channel.send("Ping?");
		m.edit(
			`Pong! Bot response latency is ${m.createdTimestamp -
			this.message.createdTimestamp}ms.`
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
				logger.info(err);
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
				logger.info(error);
			});
	}

	twitter() {
		//ex: !twitter Topics being tweeted
		const newTopic = this.args.join(" ");
		topicFile.topic = newTopic;
		fs.writeFile(
			process.env.TOPIC_FILENAME,
			JSON.stringify(topicFile, null, 2),
			err => {
				if (err) return logger.info(err);
				trackNewTopic(newTopic);
				logger.info(JSON.stringify(topicFile));
				logger.info(`Wrote "${newTopic}" to ${process.env.TOPIC_FILENAME}`);
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
				logger.info(error);
			});
	}
}
module.exports.Command = Command;
