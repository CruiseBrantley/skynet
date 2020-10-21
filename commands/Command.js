const vote = require('./vote')
const wafflehouse = require('./wafflehouse')

const publicIp = require('public-ip')
const axios = require('axios')
const googleTTS = require('google-tts-api')
const ytdl = require('ytdl-core')
const youtubeSearch = require('youtube-search')
const fs = require('fs')
const logger = require('../logger')
const { topicFile, trackNewTopic } = require('../events/twitter.js')
const decode = require('unescape')
let dispatcher = {}
let channel
let volume = 5
let lastSearch = []
let gameSessionID = 0

class Command {
  constructor (message, cmd, args, bot, database) {
    this.message = message
    this.cmd = cmd
    this.args = args
    this.bot = bot
    this.database = database
  }

  stop () {
    if (dispatcher.destroy) {
      dispatcher.destroy()
      this.bot.user.setActivity(process.env.ACTIVITY)
      channel.leave()
    }
  }

  pause () {
    if (dispatcher !== {}) {
      dispatcher.pause()
    }
  }

  resume () {
    if (dispatcher !== {}) {
      dispatcher.resume()
    }
  }

  volume () {
    if (this.args.length === 0) {
      this.message.channel.send(`The current volume is set to ${volume}.`)
      return
    }

    if (!(this.args[0] >= 0 && this.args[0] <= 20)) {
      this.message.channel.send(
        'The Volume must be between 0 and 20 (default is 5).'
      )
      return
    }
    volume = this.args.shift()
    if (dispatcher.setVolume) {
      dispatcher.setVolume(volume / 10)
    }
    this.message.channel.send(`Setting current volume to ${volume}.`)
  }

  speak () {
    // ex: !speak The words to be said in my voice channel
    try {
      const channelName = this.message.member.voiceChannelID

      channel = this.message.guild.channels.find(item => {
        return item.id === channelName && item.type === 'voice'
      })
      if (!channel) {
        this.message.channel.send(
          "You need to be in a voice channel, try !speakchannel (!sc) to send your message to a channel you're not currently in."
        )
        return
      }
    } catch (err) {
      logger.info(err)
      return
    }

    const speakMessage = this.args.join(' ')
    if (!speakMessage.length) {
      this.message.channel.send('I need a message to speak!')
      return
    }
    if (speakMessage.length > 200) {
      // Google translate API has a 200 character limitation
      this.message.channel.send(
        `I can only speak up to 200 characters at a time, you entered ${speakMessage.length}.`
      )
      return
    }
    googleTTS(speakMessage, 'en', 1).then(url => {
      channel
        .join()
        .then(connection => {
          dispatcher = connection.playStream(url)
          dispatcher.on('end', () => {
            setTimeout(() => {
              connection.disconnect()
            }, 2000)
          })
        })
        .catch(err => logger.info('Encountered an error: ', err))
    })
  }

  speakchannel () {
    // ex: !sc General The words to be said in General voice channel
    let channelName
    let speakMessage
    try {
      channelName = this.args.shift()
      speakMessage = this.args.join(' ')
      if (!speakMessage.length) {
        this.message.channel.send('I need a message to speak!')
        return
      }
      if (speakMessage.length > 200) {
        // Google translate API has a 200 character limitation
        this.message.channel.send(
          `I can only speak up to 200 characters at a time, you entered ${speakMessage.length}.`
        )
        return
      }
    } catch (err) {
      logger.info(err)
      return
    }
    googleTTS(speakMessage, 'en', 1)
      .then(url => {
        const channel = this.message.guild.channels.find(item => {
          return (
            item.name.toLowerCase() === channelName.toLowerCase() &&
            item.type === 'voice'
          )
        })
        if (channel === undefined || null) {
          this.message.channel.send(
            "Hmmm, it seems I couldn't find that channel."
          )
          return
        }
        channel
          .join()
          .then(connection => {
            dispatcher = connection.playStream(url)

            dispatcher.on('end', () => {
              channel.leave()
            })
          })
          .catch(err => logger.info('channel join error: ', err))
      })
      .catch(err => logger.info('googleTTS error: ', err))
  }

  searchyoutube () {
    // ex: !searchyoutube The query goes here
    const query = this.args.join(' ')
    if (!query) {
      this.message.channel.send('You need to supply something to search for.')
      return
    }
    const opts = {
      maxResults: 3,
      key: process.env.YOUTUBE_KEY,
      type: 'video'
    }

    youtubeSearch(query, opts, (err, results) => {
      if (err) return logger.info('youtubeSearch error: ', err)
      lastSearch = results
      results.forEach((result, index) => {
        this.message.channel.send({
          embed: {
            author: {
              name: decode(result.channelTitle)
            },
            title: decode(result.title),
            description: decode(result.description),
            url: result.link,
            color: colorFunc(index),
            timestamp: result.publishedAt,
            thumbnail: {
              url: result.thumbnails.default.url
            },
            footer: {
              text: footerFunc(index)
            }
          }
        })
      })
    })
  }

  youtube () {
    // ex: !youtube videoURL
    // ex: !youtube channel videoURL
    let channelName
    if (this.args.length < 1) {
      this.message.channel.send(
        'You can to optionally supply a channel name, but a video URL is required.'
      )
      return
    } else if (this.args.length < 2) {
      // channel = this.message.member.voice.channel;
      channelName = this.message.member.voiceChannelID

      channel = this.message.guild.channels.find(item => {
        return item.id === channelName && item.type === 'voice'
      })
    } else {
      channelName = this.args.shift()

      channel = this.message.guild.channels.find(item => {
        return (
          item.name.toLowerCase() === channelName.toLowerCase() &&
          item.type === 'voice'
        )
      })
    }
    if (channel === undefined || channel === null || channel.length < 1) {
      this.message.channel.send(
        "Hmmm, it seems I couldn't find that channel. You need to join a voice channel or specify a valid channel name."
      )
      return
    }
    let url = this.args.shift()

    if (url === 'red' && lastSearch.length) url = lastSearch[0].link
    if (url === 'orange' && lastSearch.length) url = lastSearch[1].link
    if (url === 'yellow' && lastSearch.length) url = lastSearch[2].link

    channel
      .join()
      .then(connection => {
        dispatcher = connection.playStream(
          ytdl(url, { filter: 'audioonly', quality: 'highestaudio' }),
          { volume: volume / 10, passes: 2 }
        )
        this.bot.user.setActivity('YouTube.')

        dispatcher.on('end', () => {
          this.bot.user.setActivity(process.env.ACTIVITY)
          connection.disconnect()
        })
      })
      .catch(err => logger.info('channel join error: ', err))
  }

  playvideo () {
    const query = this.args.join(' ')
    if (!query) {
      this.message.channel.send('You need to supply something to search for.')
      return
    }
    const opts = {
      maxResults: 1,
      key: process.env.YOUTUBE_KEY,
      type: 'video'
    }

    youtubeSearch(query, opts, (err, result) => {
      if (err) return logger.info('playvideo error: ', err)
      result = result[0]
      this.message.channel.send({
        embed: {
          author: {
            name: decode(result.channelTitle)
          },
          title: decode(result.title),
          description: decode(result.description),
          url: result.link,
          color: colorFunc(0),
          timestamp: result.publishedAt,
          thumbnail: {
            url: result.thumbnails.default.url
          },
          footer: {
            text: footerFunc(0)
          }
        }
      })
    })
  }

  async ping () {
    // ex: !ping
    const m = await this.message.channel.send('Ping?')
    m.edit(
      `Pong! Bot response latency is ${m.createdTimestamp -
        this.message.createdTimestamp}ms.`
    )
  }

  async server () {
    this.message.channel.send(
      `The current server ip address is: ${await publicIp.v4()}`
    )
  }

  say () {
    // ex: !say I'm telling the bot what to say.
    const sayMessage = this.args.join(' ') || ' '
    if (this.message.member.permissions.has('ADMINISTRATOR')) {
      this.message.delete().catch(() => {
        logger.info(
          'Encountered an error while deleting: ' + this.message.content
        )
      })
      this.message.channel.send(sayMessage)
    }
  }

  note () {
    // ex: !note title="New Title" Here is the content.
    let title = 'Untitled'
    let text

    text = this.args.join(' ')
    if (text.substring(0, 7).toLowerCase() === 'title="') {
      const textIndex = text.indexOf('"', 8) + 2
      title = text.substring(7, textIndex - 2)
      text = text.substring(textIndex)
    }

    axios
      .post(
        process.env.NOTESPOST,
        { title, text },
        {
          headers: {
            username: process.env.NOTESUSER,
            password: process.env.NOTESPASS
          }
        }
      )
      .then(response => {
        this.message.channel.send(
          "I've added your note. You can view them with !listnotes or online at https://cruise-notes.web.app/ login with `Cruise-bot` `Whatpassword?`"
        )
      })
      .catch(err => {
        logger.info(err)
      })
  }

  listnotes () {
    // ex: !listnotes
    axios
      .get(process.env.NOTESPOST, {
        headers: {
          username: process.env.NOTESUSER,
          password: process.env.NOTESPASS
        }
      })
      .then(response => {
        if (response.data.notes.length === 0) {
          this.message.channel.send(
            'There aren\'t currently any notes, you could change this with `!note title="New Title" The new note.`'
          )
          return
        }
        let newMessage = '```Current Notes:'
        for (const note of response.data.notes) {
          note.title === 'Untitled'
            ? (newMessage += '\n' + note.text)
            : (newMessage += '\n' + note.title + ': ' + note.text)
        }
        this.message.channel.send(newMessage + '```')
      })
      .catch(error => {
        logger.info(error)
      })
  }

  twitter () {
    // ex: !twitter Topics being tweeted
    const newTopic = this.args.join(' ')
    topicFile.topic = newTopic
    fs.writeFile(
      process.env.TOPIC_FILENAME,
      JSON.stringify(topicFile, null, 2),
      err => {
        if (err) return logger.info(err)
        trackNewTopic(newTopic)
        logger.info(JSON.stringify(topicFile))
        logger.info(`Wrote "${newTopic}" to ${process.env.TOPIC_FILENAME}`)
      }
    )
  }

  vote () {
    vote.vote(this.message, this.args, this.database)
  }

  unvote () {
    vote.unvote(this.message, this.args, this.database)
  }

  votereset () {
    vote.votereset(this.message, this.args, this.database)
  }

  voteadd () {
    vote.voteadd(this.message, this.args, this.database)
  }

  voteremove () {
    vote.voteremove(this.message, this.args, this.database)
  }

  voteclear () {
    vote.voteclear(this.message, this.args, this.database)
  }

  catfact () {
    // ex: !catfact
    axios
      .get(process.env.CATFACT_GET)
      .then(response => {
        this.message.channel.send(response.data.fact)
      })
      .catch(error => {
        logger.info(error)
      })
  }

  setsession () {
    if (
      this.args.length > 0 &&
      this.message.member.permissions.has('ADMINISTRATOR')
    ) {
      gameSessionID = this.args.shift()
      return
    }
    this.message.channel.send(
      'You need to include a sessionID, you must also have admin permissions to set sessionID.'
    )
  }

  session () {
    this.message.channel.send(`The current Session ID is: ${gameSessionID}`)
  }

  wafflehouse () {
    wafflehouse(this.message)
  }
}

function colorFunc (index) {
  if (index === 0) return 15794179
  if (index === 1) return 16748032
  if (index === 2) return 16773120
}

function footerFunc (index) {
  if (index === 0) return '!yt red'
  if (index === 1) return '!yt orange'
  if (index === 2) return '!yt yellow'
}

module.exports = Command
