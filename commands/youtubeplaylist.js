const { SlashCommandBuilder } = require('discord.js');
const ytpl = require('ytpl');
const logger = require('../logger');
const musicManager = require('../util/MusicManager');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('youtubeplaylist')
		.setDescription('Plays an entire YouTube playlist in your voice channel')
        .addStringOption(option => 
            option.setName('url')
                .setDescription('The YouTube playlist URL')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The voice channel to join')
                .addChannelTypes(2) // Voice channel type
                .setRequired(false)),
	async execute(interaction) {
        let query = interaction.options.getString('url');
        let channelName = interaction.options.getChannel('channel');

        if (!channelName) {
            const memberVoiceChannelId = interaction.member?.voice?.channelId;
            if (memberVoiceChannelId) {
                channelName = interaction.guild.channels.cache.get(memberVoiceChannelId);
            }
        }

        if (!channelName) {
            await interaction.reply({ content: "You need to be in a voice channel or to specify a channel.", ephemeral: true });
            return;
        }

        await interaction.deferReply();

        try {
            const playlistDoc = await ytpl(query, { pages: 1 });
            interaction.client.user.setActivity('YouTube.');
            
            await musicManager.addBatch(interaction, playlistDoc.items);
            await interaction.editReply({ 
                content: `Added playlist: **${playlistDoc.title}** to the queue (${playlistDoc.items.length} videos).`,
                flags: [MessageFlags.SuppressEmbeds]
            });
            
        } catch (err) {
            logger.error('ytpl error: ', err);
            await interaction.editReply("There was an error loading the playlist.");
        }
	},
};
