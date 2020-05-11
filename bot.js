const dotenv = require("dotenv");
dotenv.config();
const Discord = require("discord.js");
const winston = require("winston");

function discordBot() {
	// Initialize Discord Bot
	const bot = new Discord.Client();
	const aFunc = async () => {
		try {
			await bot.login(process.env.TOKEN);
			return bot;
		} catch (err) {
			console.error("Bot Failed Logging in: ", err)
			process.exit()
		}
	}
	aFunc()

	// Configure logger settings
	const logger = winston.createLogger({
		level: "info",
		format: winston.format.json(),
		defaultMeta: { service: "user-service" },
		transports: [new winston.transports.File({ filename: "./logs/combined.log" })]
	});
	//debug logging under here, remove for prod
	logger.add(
		new winston.transports.Console({
			format: winston.format.simple()
		})
	);
	module.exports.logger = logger;

	bot.on("ready", () => {
		logger.info("Connected");
		logger.info("Logged in as: ");
		logger.info(bot.user.username + " - (" + bot.user.id + ")");
		bot.user.setActivity('for John Connor', { type: 'WATCHING' });
	});

	bot.on("error", err => {
		logger.info("Encountered an error: ", err);
	});

	const { botUpdate } = require("./events/botUpdate");
	const { botMessage } = require("./events/botMessage");
	const { botDelete } = require("./events/botDelete");

	const { server } = require("./server/server")
	server(bot)

	// twitterChannelInit();

	bot.on("message", botMessage(bot));

	bot.on("messageUpdate", botUpdate());

	bot.on("messageDelete", botDelete());

	module.exports.bot = bot;
}

discordBot()

module.exports.discordBot = discordBot;