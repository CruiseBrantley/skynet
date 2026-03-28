const { SlashCommandBuilder } = require('discord.js');
const logger = require('../logger');
const musicManager = require('../util/MusicManager');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('youtube')
		.setDescription('Plays a YouTube video in your voice channel')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('The YouTube URL or keyword (red/orange/yellow)')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The voice channel to join (defaults to your current channel)')
                .addChannelTypes(2) // Voice channel type
                .setRequired(false)),
	async execute(interaction) {
        let query = interaction.options.getString('query');
        let channel = interaction.options.getChannel('channel');

        if (!channel) {
            const memberVoiceChannelId = interaction.member?.voice?.channelId;
            if (memberVoiceChannelId) {
                channel = interaction.guild.channels.cache.get(memberVoiceChannelId);
            }
        }

        if (!channel) {
            await interaction.reply({ content: "Hmmm, it seems I couldn't find that channel. You need to join a voice channel or specify a valid channel name.", ephemeral: true });
            return;
        }

        await interaction.deferReply();

        // Resolve search shortcuts before playing
        if (query === 'green' && global.lastSearch?.length) query = global.lastSearch[0].link;
        if (query === 'blue' && global.lastSearch?.length) query = global.lastSearch[1].link;
        if (query === 'red' && global.lastSearch?.length) query = global.lastSearch[2].link;

        try {
            const videoUrl = await musicManager.play(interaction, query);
            interaction.client.user.setActivity('YouTube.');
            await interaction.editReply({ 
                content: `Now playing: ${videoUrl}`,
                flags: [MessageFlags.SuppressEmbeds]
            });
        } catch (err) {
            logger.error('YouTube command error: ', err);
            if (err.message.includes('permission')) {
                await interaction.editReply("I don't yet have permission to join this voice channel.");
            } else {
                await interaction.editReply(`Failed to play: ${err.message}`);
            }
        }
	},
    setLastSearch: (search) => { global.lastSearch = search; }
};
