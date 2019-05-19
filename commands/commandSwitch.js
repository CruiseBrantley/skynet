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
		case "syt":
		case "searchyoutube":
		case "search":
			command.searchyoutube();
			break;
		case "v":
		case "volume":
			command.volume();
			break;
		case "stop":
			command.stop();
			break;
		case "pause":
			command.pause();
			break;
		case "resume":
			command.resume();
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
		case "ln":
			command.listnotes();
			break;
		case "twitter":
			command.twitter();
			break;
		case "catfact":
			command.catfact();
			break;
		case "setsession":
			command.setsession();
			break;
		case "session":
			command.session();
			break;
	}
}
module.exports.chatCommand = chatCommand;
