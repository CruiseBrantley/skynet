const { Command } = require("./Command");

const Discord = require("discord.io");
const winston = require("winston");
const auth = require("./auth.json");

// Configure logger settings
const logger = winston.createLogger({
	level: "info",
	format: winston.format.json(),
	defaultMeta: { service: "user-service" },
	transports: [new winston.transports.File({ filename: "combined.log" })]
});
//debug logging under here, remove for prod
logger.add(
	new winston.transports.Console({
		format: winston.format.simple()
	})
);

// Initialize Discord Bot
const bot = new Discord.Client({
	token: auth.token,
	autorun: true
});

bot.on("ready", evt => {
	logger.info("Connected");
	logger.info("Logged in as: ");
	logger.info(bot.username + " - (" + bot.id + ")");
});

bot.on("message", (user, userID, channelID, message, evt) => {
	// Our bot needs to know if it will execute a command
	// It will listen for messages that will start with `!`
	if (message.substring(0, 1) == "!") {
		let args = message.substring(1).split(" ");
		let cmd = args[0].toLowerCase();

		args = args.splice(1);
		const command = new Command(user, userID, channelID, message, cmd, evt);
		chatCommand(command);
	}
});

bot.on("messageUpdate", (originalMessage, updatedMessage, changer) => {
	console.log(originalMessage);
	if (originalMessage != undefined) {
		logger.info(
			"\nUser " +
				changer.d.author.username +
				' updated: "' +
				originalMessage.content +
				'" to "' +
				updatedMessage.content +
				'"\n'
		);
	}
});

function chatCommand(command) {
	switch (command.cmd) {
		case "ping":
			command.ping(bot, logger);
			break;
		case "server":
			command.serverIP(bot, logger);
			break;
		case "help":
			command.help(bot, logger);
			break;
		case "info":
			command.info(bot, logger);
			break;
	}
}
