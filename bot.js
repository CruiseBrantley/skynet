var Discord = require("discord.io");
const publicIp = require("public-ip");
var logger = require("winston");
var auth = require("./auth.json");
// Configure logger settings
logger.remove(logger.transports.Console);
logger.add(new logger.transports.Console(), {
	colorize: true
});
logger.level = "debug";
// Initialize Discord Bot
var bot = new Discord.Client({
	token: auth.token,
	autorun: true
});

bot.on("ready", function(evt) {
	logger.info("Connected");
	logger.info("Logged in as: ");
	logger.info(bot.username + " - (" + bot.id + ")");
});

bot.on("message", function(user, userID, channelID, message, evt) {
	// Our bot needs to know if it will execute a command
	// It will listen for messages that will start with `!`
	if (message.substring(0, 1) == "!") {
		var args = message.substring(1).split(" ");
		var cmd = args[0];

		args = args.splice(1);
		commands(cmd, channelID);
	}
});

function commands(cmd, channelID) {
	switch (cmd.toLowerCase()) {
		case "ping":
			bot.sendMessage({
				to: channelID,
				message: "Pong!"
			});
			break;
		case "server":
			findIP(channelID);
			break;
		case "help":
			help();
			break;
	}
}

async function findIP(channelID) {
	let ip = await publicIp.v4();
	bot.sendMessage({
		to: channelID,
		message: ip
	});
}

function help(channelID) {
	const message = "Commands are !Ping, !Server, and !Help";
	bot.sendMessage({
		to: channelID,
		message: message
	});
}
