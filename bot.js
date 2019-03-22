const { Command } = require("./Command");

const Discord = require("discord.io");
const logger = require("winston");
const auth = require("./auth.json");

// Configure logger settings
logger.remove(logger.transports.Console);
logger.add(new logger.transports.Console(), {
	colorize: true
});
logger.level = "debug";

// Initialize Discord Bot
const bot = new Discord.Client({
	token: auth.token,
	autorun: true
});
exports.bot = bot;

bot.on("ready", function(evt) {
	logger.info("Connected");
	logger.info("Logged in as: ");
	logger.info(bot.username + " - (" + bot.id + ")");
});

bot.on("message", function(user, userID, channelID, message, evt) {
	// Our bot needs to know if it will execute a command
	// It will listen for messages that will start with `!`
	if (message.substring(0, 1) == "!") {
		let args = message.substring(1).split(" ");
		let cmd = args[0];

		args = args.splice(1);
		command = new Command(user, userID, channelID, cmd, evt);
		chatCommand(command);
	}
});

function chatCommand(command) {
	switch (command.cmd.toLowerCase()) {
		case "ping":
			command.ping();
			break;
		case "server":
			command.serverIP();
			break;
		case "help":
			command.help();
			break;
	}
}
