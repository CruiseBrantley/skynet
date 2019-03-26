const { Command } = require("../commands/Command");
const { chatCommand } = require("../commands/chatCommand");
function botMessage(bot, logger) {
	return message => {
		if (message.author.bot) return; //ignore bots

		//Callios request
		if (
			message.content.includes(process.env.CALLIOSPHRASE) &&
			message.author.id === 213938315408179200
		) {
			message.channel.send(message.content + " <@110192893502705664>");
		}

		if (message.content.substring(0, 1) !== "!") return; //ignore non-commands

		// Listening for messages that will start with `!`
		let args = message.content.substring(1).split(/ +/g); //removes all spaces
		let cmd = args[0].toLowerCase();
		args = args.splice(1);
		const command = new Command(bot, logger, message, cmd, args);
		chatCommand(command);
	};
}
exports.botMessage = botMessage;
