const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const logger = require('../logger');
const { topicFile, trackNewTopic } = require('../events/twitter.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('twitter')
		.setDescription('Change the topics being tweeted about')
        .addStringOption(option => 
            option.setName('topic')
                .setDescription('The new topic to track')
                .setRequired(true)),
	async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            return;
        }

        const newTopic = interaction.options.getString('topic');
        topicFile.topic = newTopic;

        fs.writeFile(
            process.env.TOPIC_FILENAME,
            JSON.stringify(topicFile, null, 2),
            async err => {
                if (err) {
                    logger.info(err);
                    await interaction.reply({ content: 'There was an error updating the Twitter topics.', ephemeral: true });
                    return;
                }
                trackNewTopic(newTopic);
                logger.info(JSON.stringify(topicFile));
                logger.info(`Wrote "${newTopic}" to ${process.env.TOPIC_FILENAME}`);
                await interaction.reply(`Twitter topic has been updated to: **${newTopic}**`);
            }
        );
	},
};
