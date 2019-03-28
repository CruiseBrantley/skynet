const { configureTwitter, twitterChannelInit } = require("./events/twitter");
const { botUpdate } = require("./events/botUpdate");
const { botMessage } = require("./events/botMessage");
const { botDelete } = require("./events/botDelete");

//env config
const dotenv = require("dotenv");
dotenv.config();
const topicFile = require(process.env.TOPIC_FILENAME);

const Discord = require("discord.js");
const winston = require("winston");

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

//initialize twitter callback changes topic
const trackNewTopic = configureTwitter(topicFile);

// Initialize Discord Bot
const bot = new Discord.Client();
bot.login(process.env.TOKEN);

bot.on("ready", () => {
	logger.info("Connected");
	logger.info("Logged in as: ");
	logger.info(bot.user.username + " - (" + bot.user.id + ")");
	bot.user.setActivity("Botting");
});

twitterChannelInit(bot);

bot.on("message", botMessage(bot, logger, topicFile, trackNewTopic));

bot.on("messageUpdate", botUpdate(logger));

bot.on("messageDelete", botDelete(logger));
