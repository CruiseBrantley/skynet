function chatCommand(command) {
	switch (command.cmd) {
		case "ping":
			command.ping();
			break;
		case "speak":
			command.speak();
			break;
		case "sc":
		case "speakchannel":
			command.speakchannel();
			break;
		case "yt":
		case "youtube":
			command.youtube();
			break;
		case "stop":
			command.stop();
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
		case "catfact":
			command.catfact();
			break;
	}
}
module.exports.chatCommand = chatCommand;
