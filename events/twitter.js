const dotenv = require("dotenv");
dotenv.config();
var Twitter = require("node-tweet-stream"),
	t = new Twitter({
		consumer_key: process.env.TWITTER_CONSUMER_KEY,
		consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
		token: process.env.TWITTER_TOKEN,
		token_secret: process.env.TWITTER_SECRET
	});
let currentTopic;

//configure tweet stream
const configureTwitter = topicFile => {
	if (topicFile === undefined) {
		console.log(
			"Cannot access currentTopic.json, needs a key of topic and value of a string to track.\n",
			"Create this file then restart the server for twitter functionality"
		);
		return;
	}
	t.on("error", function(err) {
		console.log(topicFile.topic);
	});
	currentTopic = topicFile.topic;
	const trackNewTopic = newTopic => {
		t.untrackAll();
		currentTopic = newTopic;
		if (newTopic === "stop") return; //track nothing in this case
		t.track(newTopic);
	};

	if (topicFile.topic === "stop") return trackNewTopic; //track nothing in this case

	t.track(topicFile.topic);
	return trackNewTopic;
};
module.exports.configureTwitter = configureTwitter;

const twitterChannelInit = bot => {
	t.on("tweet", function(tweet) {
		bot.channels.get("558430903072718868").send({
			embed: {
				color: 3447003,
				fields: [
					{
						name: tweet.user.screen_name,
						value: tweet.text
					}
				],
				timestamp: new Date(),
				footer: {
					text: "Twitter topic: " + currentTopic
				}
			}
		});
	});
};
module.exports.twitterChannelInit = twitterChannelInit;
