const { SlashCommandBuilder } = require('discord.js');
const { getVoiceConnection, joinVoiceChannel, VoiceConnectionStatus } = require('@discordjs/voice');
const playVideo = require('../util/playVideo');
const logger = require('../logger');

// Store last search globally if needed by 'red'/'orange'/'yellow' (can be improved later)
let lastSearch = [];

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

        // Extremely basic handling of previous search references (if implemented globally)
        if (query === 'red' && global.lastSearch?.length) query = global.lastSearch[0].link;
        if (query === 'orange' && global.lastSearch?.length) query = global.lastSearch[1].link;
        if (query === 'yellow' && global.lastSearch?.length) query = global.lastSearch[2].link;

        await interaction.deferReply();

        try {
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
            });

            connection.on(VoiceConnectionStatus.Ready, async () => {
                try {
                    await playVideo(query, channel.guild.id, 5); // Default volume 5
                    interaction.client.user.setActivity('YouTube.');
                    await interaction.editReply(`Now playing: ${query}`);
                } catch(e) {
                    logger.error(e);
                    await interaction.editReply(`Failed to play video: ${e.message}`);
                }
            });
        } catch (err) {
            logger.info('channel join error: ', err);
            if (err.message.includes('permission')) {
                await interaction.editReply("I don't yet have permission to join this voice channel.");
            } else {
                await interaction.editReply("There was an error joining the voice channel.");
            }
        }
	},
    setLastSearch: (search) => { global.lastSearch = search; }
};
