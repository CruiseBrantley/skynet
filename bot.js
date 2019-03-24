const { botUpdate } = require("./events/botUpdate");
const { botMessage } = require("./events/botMessage");
const { botDelete } = require("./events/botDelete");

const Discord = require("discord.js");
const winston = require("winston");
const auth = require("./auth.json");

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

// Initialize Discord Bot
const bot = new Discord.Client();
bot.login(auth.token);

bot.on("ready", () => {
	logger.info("Connected");
	logger.info("Logged in as: ");
	logger.info(bot.user.username + " - (" + bot.user.id + ")");
	bot.user.setActivity("Administration, better watch out.");
});

bot.on("message", botMessage(bot, logger));

bot.on("messageUpdate", botUpdate(logger));

bot.on("messageDelete", botDelete(logger));
