function chatCommand(command) {
	switch (command.cmd) {
		case "ping":
			command.ping();
			break;
		case "server":
			command.server();
			break;
		case "help":
			command.help();
			break;
		case "say":
			command.say();
			break;
		case "note":
			command.note();
			break;
		case "listnotes":
			command.listnotes();
			break;
		case "twitter":
			command.twitter();
			break;
	}
}
module.exports.chatCommand = chatCommand;
