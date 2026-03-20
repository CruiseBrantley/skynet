const { SlashCommandBuilder } = require('discord.js');
const googleTTS = require('google-tts-api');
const { getVoiceConnection, joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType, VoiceConnectionStatus } = require('@discordjs/voice');
const logger = require('../logger');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('speak')
		.setDescription('Makes the bot speak a phrase using Google TTS')
        .addStringOption(option => 
            option.setName('message')
                .setDescription('The message to speak')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The voice channel to join')
                .addChannelTypes(2) // Voice channel type
                .setRequired(false)),
	async execute(interaction) {
        let query = interaction.options.getString('message');
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

        const speakMessage = query;
        if (speakMessage.length > 200) {
            await interaction.reply({ content: `I can only speak up to 200 characters at a time, you entered ${speakMessage.length}.`, ephemeral: true });
            return;
        }

        const url = googleTTS.getAudioUrl(speakMessage, { lang: 'en', host: 'https://translate.google.com' });
        
        await interaction.deferReply();
        
        try {
            const connection = joinVoiceChannel({
                channelId: channelName.id,
                guildId: channelName.guild.id,
                adapterCreator: channelName.guild.voiceAdapterCreator,
            });

            connection.on(VoiceConnectionStatus.Ready, () => {
                const player = createAudioPlayer();
                const resource = createAudioResource(url, { inputType: StreamType.Arbitrary });
                player.play(resource);
                const subscription = connection.subscribe(player);
                
                player.on('stateChange', (oldState, newState) => {
                    if (newState.status === 'idle') {
                        setTimeout(() => {
                            if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                                connection.destroy();
                            }
                        }, 2000);
                    }
                });
                interaction.editReply(`Speaking: "${speakMessage}"`);
            });
            
        } catch (err) {
            logger.info('Encountered an error: ', err);
            await interaction.editReply('There was an error trying to speak.');
        }
	},
};
