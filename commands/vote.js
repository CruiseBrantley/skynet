const logger = require('../logger')

function eligibleChannel (message) {
  // if (!(message.channel.id === "592718526083498014" || message.channel.id === "579568174392147968")) {
  // message.channel.send("This command can only be used from the designated voting channel.")
  // return false
  // }
  return true
}

function hasVoted (options, value) {
  for (let i = 0; i < options.length; i++) {
    if (options[i].hasVoted) {
      const votedIndex = options[i].hasVoted.indexOf(value)
      if (votedIndex !== -1) {
        return [options[i].title, votedIndex, i]
      }
    }
  }
  return ['not voted', -1, -1]
}

async function vote (message, args, database) {
  if (!eligibleChannel(message)) return
  try {
    const ref = database.ref(message.channel.guild.id)
    const data = await ref.once('value')
    const options = data.val()
    if (args.length < 1) {
      return message.channel.send(
        `\`\`\`md\n# The current voting record is:\n${(options || '') &&
          options
            .map(
              e =>
                String(`[${e.title}`).padEnd(50, ' ') + // eslint-disable-next-line
                `](Votes:	${
                  e.hasVoted && e.hasVoted.length ? e.hasVoted.length : 0
                })\n`
            )
            .join('')}\`\`\``
      )
    }
    const vote = args.join(' ')

    const titleVotedFor = hasVoted(options, message.member.user.id)
    if (titleVotedFor[1] !== -1) {
      message.channel.send(
        `I'm sorry, you've already voted for \`${titleVotedFor[0]}\`.`
      )
      return
    }

    function findMatchIndex (vote) {
      const found = []
      for (let i = 0; i < options.length; i++) {
        if (options[i].title.toLowerCase().includes(vote.toLowerCase())) {
          found.push(i)
        }
      }
      if (found.length > 1) {
        return found.reduce(function(a, b) {
          return options[a]?.title?.length <= options[b]?.title?.length ? a : b;
        })
      }
      return found.length ? found[0] : -1
    }

    const search = findMatchIndex(vote)
    if (search !== -1) {
      if (!options[search].hasVoted) options[search].hasVoted = []
      options[search].hasVoted.push(message.member.user.id)
      const votedFor = options[search].title
      message.channel.send(
        `Your vote for \`${votedFor}\` has been recorded, to see results use \`!vote\` or visit <https://skynet-voting.web.app/${message.channel.guild.id}>`
      )
      const sortedOptions = options.sort((item1, item2) =>
        ((item1.hasVoted && item1.hasVoted.length) || 0) <
        ((item2.hasVoted && item2.hasVoted.length) || 0)
          ? 1
          : -1
      )
      ref.set(sortedOptions)
      return
    }
    message.channel.send("I couldn't find that option.")
  } catch (err) {
    logger.error('There was a voting error: ', err)
  }
}

async function unvote (message, args, database) {
  if (!eligibleChannel(message)) return
  try {
    const ref = database.ref(message.channel.guild.id)
    const data = await ref.once('value')
    const options = data.val()

    const [, votedIndex, titleIndex] = hasVoted(options, message.member.user.id)
    if (titleIndex !== undefined && titleIndex !== -1) {
      options[titleIndex].hasVoted.splice(votedIndex, 1)
      const sortedOptions = options.sort((item1, item2) =>
        ((item1.hasVoted && item1.hasVoted.length) || 0) <
        ((item2.hasVoted && item2.hasVoted.length) || 0)
          ? 1
          : -1
      )
      ref.set(sortedOptions)
    } else {
      message.channel.send("You haven't even voted...")
      return
    }
    message.channel.send('Your vote has been reset.')
  } catch (err) {
    logger.error('There was an unvote error: ', err)
  }
}

async function votereset (message, args, database) {
  try {
    if (message.member.permissions.has('ADMINISTRATOR')) {
      const ref = database.ref(message.channel.guild.id)
      const data = await ref.once('value')
      const options = data.val()

      for (const option of options) {
        option.hasVoted = []
      }

      ref.set(options)
      message.channel.send('The vote count has been reset.')
      return
    }
    message.channel.send('You must have admin permissions to reset the vote.')
  } catch (err) {
    logger.error('There was a votereset error: ', err)
  }
}

async function voteadd (message, args, database) {
  try {
    if (message.member.permissions.has('ADMINISTRATOR')) {
      const ref = database.ref(message.channel.guild.id)
      const data = await ref.once('value')
      let options = data.val()
      if (!options) options = []

      if (args.length > 0) {
        args
          .join(' ')
          .split(',')
          .forEach(each => {
            if (
              options.findIndex(
                item => item.title.toLowerCase() === each.toLowerCase()
              ) === -1
            )
              options.push({ title: each.trim(), hasVoted: [] })
          })

        ref.set(options)
        message.channel.send('Added successfully.')
      } else message.channel.send('You need to specify something to add.')
      return
    }
    message.channel.send(
      'You must have admin permissions to modify vote options.'
    )
  } catch (err) {
    logger.error('There was a voteadd error: ', err)
  }
}

async function voteremove (message, args, database) {
  try {
    if (message.member.permissions.has('ADMINISTRATOR')) {
      const ref = database.ref(message.channel.guild.id)
      const data = await ref.once('value')
      const options = data.val()

      const toBeRemoved = args.join(' ')
      let flag = false
      if (args.length > 0) {
        for (let i = 0; i < options.length; i++) {
          if (options[i].title.toLowerCase() === toBeRemoved.toLowerCase()) {
            flag = true
            options.splice(i, 1)
          }
        }
        if (!flag) {
          message.channel.send(`Couldn't find ${toBeRemoved}.`)
          return
        }

        ref.set(options)
        message.channel.send(`\`${toBeRemoved}\` was removed successfully.`)
      } else message.channel.send('You need to specify something to remove.')
      return
    }
    message.channel.send(
      'You must have admin permissions to modify vote options.'
    )
  } catch (err) {
    logger.error('There was a voteremove error: ', err)
  }
}

async function voteclear (message, args, database) {
  try {
    if (message.member.permissions.has('ADMINISTRATOR')) {
      const ref = database.ref(message.channel.guild.id)
      ref.set([])
      message.channel.send('Cleared all vote options.')
      return
    }
    message.channel.send(
      'You must have admin permissions to modify vote options.'
    )
  } catch (err) {
    logger.error('There was a voteclear error: ', err)
  }
}

module.exports = {
  vote,
  unvote,
  votereset,
  voteadd,
  voteremove,
  voteclear
}
