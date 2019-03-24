const { Command } = require("./Command");

const Discord = require("discord.js");
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
const bot = new Discord.Client();
bot.login(auth.token);

bot.on("ready", () => {
	logger.info("Connected");
	logger.info("Logged in as: ");
	logger.info(bot.user.username + " - (" + bot.user.id + ")");
	bot.user.setActivity("Administration, better watch out.");
});

bot.on("message", message => {
	if (message.author.bot) return; //ignore bots
	if (message.content.substring(0, 1) !== "!") return; //ignore non-commands

	// Listening for messages that will start with `!`
	let args = message.content.substring(1).split(/ +/g); //removes all spaces
	let cmd = args[0].toLowerCase();

	args = args.splice(1);
	const command = new Command(message, cmd, args);
	chatCommand(command);
});

bot.on("messageUpdate", (originalMessage, updatedMessage) => {
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
});

function chatCommand(command) {
	switch (command.cmd) {
		case "ping":
			command.ping(bot);
			break;
		case "server":
			command.server(bot, logger);
			break;
		case "help":
			command.help();
			break;
		case "say":
			command.say();
			break;
	}
}
