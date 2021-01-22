var Twitter = require('node-tweet-stream')
var t = new Twitter({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  token: process.env.TWITTER_TOKEN,
  token_secret: process.env.TWITTER_SECRET
})
const topicFile = require('../twitterTopic.json')
module.exports.topicFile = topicFile
let currentTopic

// configure tweet stream
const configureTwitter = bot => {
  if (topicFile === undefined) {
    console.log(
      'Cannot access twitterTopic.json, needs an object with key of topic and value of a string to track.\n',
      'Create this file then restart the server for twitter functionality'
    )
    return
  }
  t.on('error', function (err) {
    console.log(topicFile.topic, err)
  })
  currentTopic = topicFile.topic

  t.on('tweet', function (tweet) {
    bot.channels.cache.find(item => {
      return item.id === process.env.TWITTER_CHANNEL
    }).send(`https://twitter.com/${tweet.user.screen_name}/status/${tweet.id_str}`, {
      embed: {
        thumbnail: {
          url: tweet.user.profile_image_url
        },
        url: `https://twitter.com/${tweet.user.screen_name}`,
        color: 3447003,
        author: {
          name: tweet.user.name
        },
        title: tweet.user.screen_name,
        description: tweet.text,
        timestamp: new Date(),

        // regex to match the innerText of the anchor tag in tweet.source
        footer: {
          text: 'Source: ' + tweet.source.match(/<a [^>]+>([^<]+)<\/a>/)[1]
        }
      }
    })
  })
  if (currentTopic !== 'stop') {
    t.track(topicFile.topic)
  }
  // callback function to update tracking with new topics
  const trackNewTopic = newTopic => {
    t.untrackAll()
    currentTopic = newTopic
    if (newTopic !== 'stop') t.track(newTopic) // track nothing in this case
  }
  module.exports.trackNewTopic = trackNewTopic
}
module.exports.configureTwitter = configureTwitter
