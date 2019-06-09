const dotenv = require("dotenv");
dotenv.config();
const Discord = require("discord.js");
const winston = require("winston");
// Initialize Discord Bot
const bot = new Discord.Client();
bot.login(process.env.TOKEN);
module.exports.bot = bot;

// Initialize Twitch Client
const TwitchClient = require('twitch').default;
const twitchClient = TwitchClient.withClientCredentials(process.env.TWITCH_CLIENTID, process.env.TWITCH_SECRET);
module.exports.twitchClient = twitchClient;

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
// const { streamSchedule } = require("./events/streamSchedule");

bot.on("ready", () => {
	logger.info("Connected");
	logger.info("Logged in as: ");
	logger.info(bot.user.username + " - (" + bot.user.id + ")");
	bot.user.setActivity(process.env.ACTIVITY);
	// streamSchedule();
});

bot.on("error", err => {
	logger.info("Encountered an error: ", err);
});

const { configureTwitter } = require("./events/twitter");

//initialize twitter
configureTwitter();

const { botUpdate } = require("./events/botUpdate");
const { botMessage } = require("./events/botMessage");
const { botDelete } = require("./events/botDelete");

// twitterChannelInit();

bot.on("message", botMessage());

bot.on("messageUpdate", botUpdate());

bot.on("messageDelete", botDelete());
