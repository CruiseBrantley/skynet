const { SlashCommandBuilder } = require('discord.js');
const { getVoiceConnection, joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const logger = require('../logger');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');
const path = require('path');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('speak')
		.setDescription('Makes the bot speak a phrase using local audio synthesis')
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
        if (speakMessage.length > 300) {
            await interaction.reply({ content: `I can only speak up to 300 characters at a time.`, ephemeral: true });
            return;
        }

        await interaction.deferReply();
        
        const tempDir = path.join(__dirname, '../temp_audio');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
        
        const tempWav = path.join(tempDir, `speak_${interaction.id}.wav`);
        const tempMp3 = path.join(tempDir, `speak_${interaction.id}.mp3`);

        try {
            // Step 1: Generate high quality local TTS with Piper
            const piperPath = path.join(__dirname, '../tts_engine/piper_venv/bin/piper');
            const modelPath = path.join(__dirname, '../tts_engine/en_US-danny-low.onnx');
            
            await exec(`echo "${speakMessage.replace(/"/g, '\\"')}" | "${piperPath}" --model "${modelPath}" --output_file "${tempWav}"`);

            // Step 2: Skip FFmpeg filtering, just copy to mp3 (or we can just stream wav)
            // It's actually easier to just play the WAV file directly with Discord.js
            await exec(`/opt/homebrew/bin/ffmpeg -y -i "${tempWav}" -acodec libmp3lame "${tempMp3}"`);

            const connection = joinVoiceChannel({
                channelId: channelName.id,
                guildId: channelName.guild.id,
                adapterCreator: channelName.guild.voiceAdapterCreator,
            });

            // Wait for connection to be ready
            logger.info(`Voice connection state: ${connection.state.status}`);
            if (connection.state.status !== VoiceConnectionStatus.Ready) {
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error(`Voice connection timed out in state: ${connection.state.status}`));
                    }, 15000);
                    connection.on(VoiceConnectionStatus.Ready, () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                    connection.on(VoiceConnectionStatus.Destroyed, () => {
                        clearTimeout(timeout);
                        reject(new Error('Voice connection was destroyed'));
                    });
                });
            }
            logger.info('Voice connection ready, playing audio');

            const player = createAudioPlayer();
            const resource = createAudioResource(tempMp3, { inputType: StreamType.Arbitrary });
            player.play(resource);
            connection.subscribe(player);
            
            player.on('stateChange', (oldState, newState) => {
                if (newState.status === 'idle') {
                    setTimeout(() => {
                        if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                            connection.destroy();
                        }
                        // Cleanup temp files
                        try {
                            if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
                            if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
                        } catch (e) {}
                    }, 2000);
                }
            });
            // await interaction.editReply(`Speaking: "${speakMessage}"`);
            
        } catch (err) {
            logger.info('Encountered an error speaking: ', err);
            // await interaction.editReply('There was an error trying to speak.');
            // Cleanup on error
            try {
                if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
                if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
            } catch (e) {}
        }
	},
};
