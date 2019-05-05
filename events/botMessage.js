const { Command } = require("../commands/Command");
const { chatCommand } = require("../commands/commandSwitch");
function botMessage() {
	return message => {
		if (message.author.bot) return; //ignore bots

		//Callios request - Saving for now
		// if (
		// 	message.content.includes(process.env.CALLIOS_PHRASE) &&
		// 	message.author.id === process.env.CALLIOS_USER_MONITOR
		// ) {
		// 	message.channel.send(
		// 		`${message.content} <@${process.env.CALLIOS_USER_MENTION}>`
		// 	);
		// }

		if (message.content.substring(0, 1) !== "!") return; //ignore non-commands

		// Listening for messages that will start with `!`
		let args = message.content.substring(1).split(/ +/g); //removes all spaces
		let cmd = args[0].toLowerCase();
		args = args.splice(1);
		const command = new Command(message, cmd, args);
		chatCommand(command);
	};
}
module.exports.botMessage = botMessage;
