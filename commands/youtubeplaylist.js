const { SlashCommandBuilder } = require('discord.js');
const { getVoiceConnection, joinVoiceChannel, VoiceConnectionStatus } = require('@discordjs/voice');
const playVideo = require('../util/playVideo');
const ytpl = require('ytpl');
const logger = require('../logger');

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

        let connection;
        try {
            connection = joinVoiceChannel({
                channelId: channelName.id,
                guildId: channelName.guild.id,
                adapterCreator: channelName.guild.voiceAdapterCreator,
            });
        } catch (err) {
            logger.info('channel join error: ', err);
            await interaction.editReply("I don't yet have permission to join this voice channel.");
            return;
        }

        async function startPlaylist (playlistItems, connectionObj) {
            if (playlistItems.length == 0) {
                interaction.client.user.setActivity(process.env.ACTIVITY);
                connectionObj.destroy();
                return;
            }
            
            const nextVideoUrl = playlistItems.shift().shortUrl;
            
            try {
                const subscription = await playVideo(nextVideoUrl, connectionObj.joinConfig.guildId, 5);
                
                subscription.player.on('stateChange', async (oldState, newState) => {
                    if (newState.status === 'idle') {
                        await startPlaylist(playlistItems, connectionObj);
                    }
                });
                
                subscription.player.on('error', async err => {
                    console.log('Player Error:', err);
                    await startPlaylist(playlistItems, connectionObj);
                });
                
            } catch (e) {
                console.log('Error starting playlist video:', e);
                await startPlaylist(playlistItems, connectionObj);
            }
        }

        try {
            const playlistDoc = await ytpl(query, { pages: 1 });
            interaction.client.user.setActivity('YouTube.');
            console.log('Playlist Items Length:', playlistDoc.items.length);
            
            // Expose the global playlist context if you want skipsong to work (basic implementation)
            global.globalPlaylist = playlistDoc.items;
            global.globalConnection = connection;

            connection.on(VoiceConnectionStatus.Ready, async () => {
                await startPlaylist(playlistDoc.items, connection);
                await interaction.editReply(`Now playing playlist: **${playlistDoc.title}** (${playlistDoc.items.length} videos)`);
            });
            
        } catch (err) {
            logger.error('ytpl error: ', err);
            await interaction.editReply("There was an error loading the playlist.");
        }
	},
};
