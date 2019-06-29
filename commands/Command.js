const publicIp = require("public-ip");
const axios = require("axios");
const googleTTS = require("google-tts-api");
const ytdl = require("ytdl-core");
const youtubeSearch = require("youtube-search");
const fs = require("fs");
const { logger, bot } = require("../bot.js");
const { topicFile, trackNewTopic } = require("../events/twitter.js");
const decode = require("unescape");
const moment = require("moment");
const { Twitch } = require("../events/twitch.js");
const twitch = new Twitch();
let dispatcher = {};
let channel;
let volume = 5;
let lastSearch = [];
let gameSessionID = 0;

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
	"catfact",
	"setSession",
	"session"
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
			bot.user.setActivity(process.env.ACTIVITY);
			channel.leave();
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

		if (!(this.args[0] >= 0 && this.args[0] <= 20)) {
			this.message.channel.send("The Volume must be between 0 and 20 (default is 5).");
			return;
		}
		volume = this.args.shift();
		if (dispatcher.hasOwnProperty("setVolume")) {
			dispatcher.setVolume(volume / 10);
		}
		this.message.channel.send(`Setting current volume to ${volume}.`);
	}

	speak() {
		//ex: !speak The words to be said in my voice channel
		if (!this.message.member.voice.channel) {
			this.message.channel.send("You need to be in a voice channel, try !speakchannel (!sc) to send your message to a channel you're not currently in.");
			return;
		}

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

					dispatcher.on("end", () => {
						channel.leave();
					});
				}).catch(err => logger.info("channel join error: ", err));
		}).catch(err => logger.info("googleTTS error: ", err));
	}

	searchyoutube() {
		//ex: !searchyoutube The query goes here
		const query = this.args.join(" ");
		if (!query) {
			this.message.channel.send("You need to supply something to search for.");
			return;
		}
		const opts = {
			maxResults: 3,
			key: process.env.YOUTUBE_KEY,
			type: "video"
		};

		youtubeSearch(query, opts, (err, results) => {
			if (err) return logger.info("youtubeSearch error: ", err);
			lastSearch = results;
			results.forEach((result, index) => {
				this.message.channel.send({
					embed: {
						"author": {
							"name": decode(result.channelTitle),
						},
						"title": decode(result.title),
						"description": decode(result.description),
						"url": result.link,
						"color": colorFunc(index),
						"timestamp": result.publishedAt,
						"thumbnail": {
							"url": result.thumbnails.default.url
						}, "footer": {
							"text": footerFunc(index)
						}
					}
				})
			})
		})

		function colorFunc(index) {
			if (index === 0) return 15794179;
			if (index === 1) return 16748032;
			if (index === 2) return 16773120;
		}

		function footerFunc(index) {
			if (index === 0) return "!yt red";
			if (index === 1) return "!yt orange";
			if (index === 2) return "!yt yellow";
		}
	}

	youtube() {
		//ex: !youtube videoURL
		//ex: !youtube channel videoURL
		let channelName;
		if (this.args.length < 1) {
			this.message.channel.send("You can to optionally supply a channel name, but a video URL is required.");
			return;
		} else if (this.args.length < 2) {
			channel = this.message.member.voice.channel;
		} else {
			channelName = this.args.shift();

			channel = this.message.guild.channels.find(item => {
				return (
					item.name.toLowerCase() === channelName.toLowerCase() &&
					item.type === "voice"
				);
			});
		}
		if (channel === undefined || channel === null || channel.length < 1) {
			this.message.channel.send(
				"Hmmm, it seems I couldn't find that channel. You need to join a voice channel or specify a valid channel name."
			);
			return;
		}
		let url = this.args.shift();

		if (url === "red" && lastSearch) url = lastSearch[0].link;
		if (url === "orange" && lastSearch) url = lastSearch[1].link;
		if (url === "yellow" && lastSearch) url = lastSearch[2].link;

		channel
			.join()
			.then(connection => {
				dispatcher = connection.play(ytdl(url, { filter: "audioonly", quality: 'highestaudio' }), { volume: volume / 10, passes: 2 });
				bot.user.setActivity("YouTube.");

				dispatcher.on("end", () => {
					bot.user.setActivity(process.env.ACTIVITY);
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
		const sayMessage = this.args.join(" ") || " ";
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

	vote() {
		if (!(this.message.channel.id === "592718526083498014" || this.message.channel.id === "579568174392147968")) {
			this.message.channel.send("This command can only be used from the `retro-gaming` channel.");
			return;
		}

		const voteTopic = require("../voteTopic.json");
		const options = voteTopic || [];

		if (this.args.length < 1) {
			this.message.channel.send(`\`\`\`md\n# The current voting record is:\n${options.map(e => String(`[${e.title}`).padEnd(50, " ") + `](Votes:	${e.votes})\n`).join('')}\`\`\``);
			return;
		}
		const vote = this.args.join(" ");

		function hasVoted(value) {
			for (let option of options) {
				if (option.hasVoted.includes(value)) {
					return option.title;
				}
			}
			return false;
		}

		let titleVotedFor = hasVoted(this.message.member.user.id)
		if (titleVotedFor) {
			this.message.channel.send(`I'm sorry, you've already voted for \`${titleVotedFor}\`.`);
			return;
		}

		function findMatchIndex(search) {
			for (let i = 0; i < options.length; i++) {
				if (options[i].title.toLowerCase().includes(search.toLowerCase())) return i;
			}
			return -1;
		}
		const search = findMatchIndex(vote);
		if (search !== -1) {
			options[search].votes++;
			options[search].hasVoted.push(this.message.member.user.id);
			this.message.channel.send(`Your vote for \`${options[search].title}\` has been recorded, to see results use \`!vote\``);
			const sortedOptions = options.sort((item1, item2) => parseInt(item1.votes) < parseInt(item2.votes) ? 1 : -1);
			fs.writeFile(
				process.env.VOTE_FILENAME,
				JSON.stringify(sortedOptions, null, 2),
				err => {
					if (err) return logger.info(err);
					logger.info(`Recorded vote.`);
				}
			);
			return;
		}
		this.message.channel.send("I couldn't find that option.");
	}

	unvote() {
		if (!(this.message.channel.id === "592718526083498014" || this.message.channel.id === "579568174392147968")) {
			this.message.channel.send("This command can only be used from the `retro-gaming` channel.");
			return;
		}

		const voteTopic = require("../voteTopic.json");
		const options = voteTopic || [];

		function hasVoted(value) {
			for (let i = 0; i < options.length; i++) {
				const votedIndex = options[i].hasVoted.indexOf(value);
				if (votedIndex !== -1) {
					return [i, votedIndex];
				}
			}
			return [-1, -1];
		}

		const [search, hasVotedIndex] = hasVoted(this.message.member.user.id);
		console.log(search, hasVotedIndex)
		if (search !== -1) {
			options[search].votes--;
			options[search].hasVoted.splice(hasVotedIndex, 1);
			fs.writeFile(
				process.env.VOTE_FILENAME,
				JSON.stringify(options, null, 2),
				err => {
					if (err) return logger.info(err);
					logger.info("Reset Votes.");
				}
			);
		} else {
			this.message.channel.send("You haven't even voted...");
			return;
		}
		this.message.channel.send("Your vote has been reset.");
	}

	votereset() {
		if (this.message.member.permissions.has("ADMINISTRATOR")) {

			if (!(this.message.channel.id === "592718526083498014" || this.message.channel.id === "579568174392147968")) {
				this.message.channel.send("This command can only be used from the `retro-gaming` channel.");
				return;
			}

			const voteTopic = require("../voteTopic.json");
			const options = voteTopic || [];

			for (let option of options) {
				option.votes = 0;
				option.hasVoted = [];
			}

			fs.writeFile(
				process.env.VOTE_FILENAME,
				JSON.stringify(options, null, 2),
				err => {
					if (err) return logger.info(err);
					logger.info("Reset Votes.");
				}
			);
			this.message.channel.send("The vote count has been reset.");
			return;
		}
		this.message.channel.send("You must have admin permissions to reset the vote.");
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

	setsession() {
		if (this.args.length > 0 && this.message.member.permissions.has("ADMINISTRATOR")) {
			gameSessionID = this.args.shift();
			return;
		}
		this.message.channel.send("You need to include a sessionID, you must also have admin permissions to set sessionID.");
	}

	session() {
		this.message.channel.send(`The current Session ID is: ${gameSessionID}`);
	}

	uptime() {
		if (this.args.length < 1) {
			twitch.streamProperties("fire_raven").then(properties => {
				if (properties === null) {
					this.message.channel.send("Fireraven is not currently streaming.");
					return;
				}
				this.message.channel.send(`Fireraven has been streaming since ${moment(properties._data.created_at).fromNow()}.`);
			})
			return;
		}
		const user = this.args.shift();
		twitch.streamProperties(user).then(properties => {
			if (properties === null) {
				this.message.channel.send(`${user} is not currently streaming.`);
				return;
			}
			this.message.channel.send(`${user} has been streaming since ${moment(properties._data.created_at).fromNow()}.`);
		})
	}

	islive() {
		if (this.args.length > 0) {
			const user = this.args.shift();
			twitch.isStreamLive(user).then(res => {
				this.message.channel.send(`${user} ${res ? "is" : "is not"} online.`);
			}).catch(e => {
				logger.info("There was an error in isStreamLive: ", e);
			})
		} else {
			twitch.isStreamLive("fire_raven").then(res => {
				this.message.channel.send(`Fireraven ${res ? "is" : "is not"} online.`);
			}).catch(e => {
				logger.info("There was an error in isStreamLive: ", e);
			})
		}
	}
}
module.exports.Command = Command;
