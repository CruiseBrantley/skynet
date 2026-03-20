const { SlashCommandBuilder } = require('discord.js');
const logger = require('../logger');

function eligibleChannel (interaction) {
  // if (!(interaction.channelId === "592718526083498014" || interaction.channelId === "579568174392147968")) {
  // interaction.reply({ content: "This command can only be used from the designated voting channel.", ephemeral: true })
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vote')
    .setDescription('Voting system commands')
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List current voting options and results'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('cast')
        .setDescription('Cast a vote for an option')
        .addStringOption(option => option.setName('option').setDescription('The option to vote for').setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('unvote')
        .setDescription('Remove your current vote'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a new voting option (Admin only)')
        .addStringOption(option => option.setName('options').setDescription('Comma separated list of options to add').setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a voting option (Admin only)')
        .addStringOption(option => option.setName('option').setDescription('The option to remove').setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('reset')
        .setDescription('Reset all votes to zero (Admin only)'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear')
        .setDescription('Clear all voting options entirely (Admin only)')),

  async execute(interaction, database) {
    if (!eligibleChannel(interaction)) return;
    const subcommand = interaction.options.getSubcommand();
    const ref = database.ref(interaction.guildId);
    
    try {
      if (subcommand === 'list') {
        const data = await ref.once('value');
        const options = data.val();
        await interaction.reply(
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
        );
      } 
      else if (subcommand === 'cast') {
        const optionToVote = interaction.options.getString('option');
        const data = await ref.once('value');
        const options = data.val() || [];
        
        const titleVotedFor = hasVoted(options, interaction.user.id);
        if (titleVotedFor[1] !== -1) {
          await interaction.reply(`I'm sorry, you've already voted for \`${titleVotedFor[0]}\`.`);
          return;
        }

        function findMatchIndex (voteStr) {
          const found = []
          for (let i = 0; i < options.length; i++) {
            if (options[i].title.toLowerCase().includes(voteStr.toLowerCase())) {
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

        const search = findMatchIndex(optionToVote);
        if (search !== -1) {
          if (!options[search].hasVoted) options[search].hasVoted = []
          options[search].hasVoted.push(interaction.user.id)
          const votedFor = options[search].title
          await interaction.reply(`Your vote for \`${votedFor}\` has been recorded.`)
          
          const sortedOptions = options.sort((item1, item2) =>
            ((item1.hasVoted && item1.hasVoted.length) || 0) <
            ((item2.hasVoted && item2.hasVoted.length) || 0)
              ? 1
              : -1
          )
          ref.set(sortedOptions)
          return
        }
        await interaction.reply({ content: "I couldn't find that option.", ephemeral: true });
      }
      else if (subcommand === 'unvote') {
        const data = await ref.once('value');
        const options = data.val() || [];
        const [, votedIndex, titleIndex] = hasVoted(options, interaction.user.id);
        
        if (titleIndex !== undefined && titleIndex !== -1) {
          options[titleIndex].hasVoted.splice(votedIndex, 1)
          const sortedOptions = options.sort((item1, item2) =>
            ((item1.hasVoted && item1.hasVoted.length) || 0) <
            ((item2.hasVoted && item2.hasVoted.length) || 0)
              ? 1
              : -1
          )
          ref.set(sortedOptions)
          await interaction.reply('Your vote has been reset.');
        } else {
          await interaction.reply({ content: "You haven't even voted...", ephemeral: true })
        }
      }
      else if (subcommand === 'add') {
        if (!interaction.member.permissions.has('Administrator')) {
          await interaction.reply({ content: 'You must have admin permissions to modify vote options.', ephemeral: true });
          return;
        }
        const data = await ref.once('value');
        let options = data.val() || [];
        const newOptionsStr = interaction.options.getString('options');
        
        newOptionsStr.split(',').forEach(each => {
          if (options.findIndex(item => item.title.toLowerCase() === each.trim().toLowerCase()) === -1) {
            options.push({ title: each.trim(), hasVoted: [] })
          }
        });
        
        ref.set(options);
        await interaction.reply('Added successfully.');
      }
      else if (subcommand === 'remove') {
        if (!interaction.member.permissions.has('Administrator')) {
          await interaction.reply({ content: 'You must have admin permissions to modify vote options.', ephemeral: true });
          return;
        }
        const data = await ref.once('value');
        const options = data.val() || [];
        const toBeRemoved = interaction.options.getString('option');
        
        let flag = false;
        for (let i = 0; i < options.length; i++) {
          if (options[i].title.toLowerCase() === toBeRemoved.toLowerCase()) {
            flag = true
            options.splice(i, 1)
            break;
          }
        }
        
        if (!flag) {
          await interaction.reply({ content: `Couldn't find ${toBeRemoved}.`, ephemeral: true });
          return;
        }
        
        ref.set(options);
        await interaction.reply(`\`${toBeRemoved}\` was removed successfully.`);
      }
      else if (subcommand === 'reset') {
        if (!interaction.member.permissions.has('Administrator')) {
          await interaction.reply({ content: 'You must have admin permissions to reset the vote.', ephemeral: true });
          return;
        }
        const data = await ref.once('value');
        const options = data.val() || [];
        for (const option of options) {
          option.hasVoted = []
        }
        ref.set(options)
        await interaction.reply('The vote count has been reset.');
      }
      else if (subcommand === 'clear') {
        if (!interaction.member.permissions.has('Administrator')) {
          await interaction.reply({ content: 'You must have admin permissions to modify vote options.', ephemeral: true });
          return;
        }
        ref.set([]);
        await interaction.reply('Cleared all vote options.');
      }
    } catch (err) {
      logger.error(`There was a vote error (${subcommand}): `, err);
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: 'An error occurred processing your vote command.', ephemeral: true });
      } else {
        await interaction.reply({ content: 'An error occurred processing your vote command.', ephemeral: true });
      }
    }
  }
};
