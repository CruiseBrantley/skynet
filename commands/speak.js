const { SlashCommandBuilder } = require('discord.js');
const { getVoiceConnection, joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const logger = require('../logger');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');
const path = require('path');

/**
 * Resolves Discord mentions (Users, Roles, Channels) to their display names.
 */
async function resolveMentions(text, guild) {
    if (!guild || !text) return text;
    
    // 1. Resolve Users/Members: <@123> or <@!123>
    const userRegex = /<@!?(\d+)>/g;
    let match;
    // We use a clone of the text to avoid index issues during loop
    let result = text;
    while ((match = userRegex.exec(text)) !== null) {
        const userId = match[1];
        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
        const displayName = member ? (member.nickname || member.user.username) : "someone";
        result = result.replaceAll(match[0], displayName);
    }
    
    // 2. Resolve Roles: <@&123>
    const roleRegex = /<@&(\d+)>/g;
    while ((match = roleRegex.exec(text)) !== null) {
        const roleId = match[1];
        const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
        const roleName = role ? role.name : "a role";
        result = result.replaceAll(match[0], roleName);
    }
    
    // 3. Resolve Channels: <#123>
    const channelRegex = /<#(\d+)>/g;
    while ((match = channelRegex.exec(text)) !== null) {
        const channelId = match[1];
        const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
        const channelName = channel ? channel.name : "a channel";
        result = result.replaceAll(match[0], channelName);
    }
    
    return result;
}

/**
 * Strips Discord markdown and technical tags.
 */
function stripMarkdown(text) {
    if (!text) return text;
    return text
        .replace(/<t:[0-9]+(:[a-zA-Z])?>/g, '') // Timestamps
        .replace(/<:[a-zA-Z0-9_]+:[0-9]+>/g, '') // Custom Emojis
        .replace(/[*_~`|]/g, '')                 // Markdown bold/italics/etc
        .replace(/#+ /g, '')                     // Heading hashes
        .replace(/>+ /g, '')                     // Quote symbols
        .replace(/\s+/g, ' ')                  // Normalize whitespace
        .trim();
}


module.exports = {
	data: new SlashCommandBuilder()
		.setName('speak')
		.setDescription('Makes the bot speak a phrase using local audio synthesis')
        .addStringOption(option => 
            option.setName('message')
                .setDescription('The message to speak')
                .setRequired(true)
                .setMaxLength(6000))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The voice channel to join')
                .addChannelTypes(2) // Voice channel type
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The specific user to follow into voice')
                .setRequired(false)),
	async execute(interaction) {
        let query = interaction.options.getString('message');
        let channelName = interaction.options.getChannel('channel');
        
        if (!channelName) {
            // Priority 1: Specifically targeted user
            const targetUser = interaction.options.getMember('user');
            if (targetUser?.voice?.channelId) {
                channelName = interaction.guild.channels.cache.get(targetUser.voice.channelId);
                if (channelName) {
                    logger.info(`Speak: Target user ${targetUser.user.tag} followed into voice channel ${channelName.name}`);
                }
            }

            // Priority 2: Check for mentioned users in the message (discovery)
            if (!channelName) {
                const mentionRegex = /<@!?(\d+)>/g;
                let match;
                while ((match = mentionRegex.exec(query)) !== null) {
                    const userId = match[1];
                    const member = interaction.guild.members.cache.get(userId) || await interaction.guild.members.fetch(userId).catch(() => null);
                    if (member?.voice?.channelId) {
                        channelName = interaction.guild.channels.cache.get(member.voice.channelId);
                        if (channelName) {
                            logger.info(`Speak: Following mentioned user ${member.user.tag} into voice channel ${channelName.name}`);
                            break;
                        }
                    }
                }
            }

            // Priority 3: Fall back to speaker's voice channel
            if (!channelName) {
                const memberVoiceChannelId = interaction.member?.voice?.channelId;
                if (memberVoiceChannelId) {
                    channelName = interaction.guild.channels.cache.get(memberVoiceChannelId);
                }
            }
        }

        if (!channelName) {
            await interaction.reply({ content: "You need to be in a voice channel or to specify a channel.", ephemeral: true });
            return;
        }

        // Natural Translation: Resolve mentions and strip markdown/tags
        const translatedMessage = stripMarkdown(await resolveMentions(query, interaction.guild));
        const speakMessage = translatedMessage || "I have nothing to say.";


        await interaction.deferReply();
        
        const tempDir = path.join(__dirname, '../temp_audio');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
        
        const tempWav = path.join(tempDir, `speak_${interaction.id}.wav`);
        const tempMp3 = path.join(tempDir, `speak_${interaction.id}.mp3`);

        let musicQueue = null;
        const musicManager = require('../util/MusicManager');
        const activeQueue = musicManager.getQueue(interaction.guildId);
        const isMusicPlaying = activeQueue && activeQueue.isPlaying();

        if (isMusicPlaying) {
            musicQueue = activeQueue;
            musicQueue.player.pause();
            logger.info(`Speak: Pausing music in guild ${interaction.guildId} for TTS`);
        }

        try {
            // Step 1: Generate high quality local TTS with Piper
            const piperPath = path.join(__dirname, '../tts_engine/piper_venv/bin/piper');
            const ttsModel = process.env.TTS_MODEL;
            const modelPath = path.join(__dirname, '../tts_engine', ttsModel);
            
            await exec(`echo "${speakMessage.replace(/"/g, '\\"')}" | "${piperPath}" --model "${modelPath}" --output_file "${tempWav}"`);

            // Step 2: Skip FFmpeg filtering, just copy to mp3 (or we can just stream wav)
            await exec(`/opt/homebrew/bin/ffmpeg -y -i "${tempWav}" -acodec libmp3lame "${tempMp3}"`);

            // Step 3: Connection handling (Music-Aware)
            let connection = getVoiceConnection(interaction.guildId);
            
            if (!connection) {
                connection = joinVoiceChannel({
                    channelId: channelName.id,
                    guildId: channelName.guild.id,
                    adapterCreator: channelName.guild.voiceAdapterCreator,
                });
            }

            // Wait for connection to be ready
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

            const player = createAudioPlayer();
            const resource = createAudioResource(tempMp3, { inputType: StreamType.Arbitrary });
            
            // Subscribe the TTS player to the connection (overrides music)
            const subscription = connection.subscribe(player);
            player.play(resource);
            
            player.on('stateChange', (oldState, newState) => {
                if (newState.status === 'idle') {
                    // Restore music if it was paused
                    if (musicQueue) {
                        logger.info(`Speak: TTS finished, resuming music in guild ${interaction.guildId}`);
                        subscription.unsubscribe();
                        // Re-subscribe the music player
                        connection.subscribe(musicQueue.player);
                        musicQueue.player.unpause();
                    } else {
                        // Standard cleanup (No music)
                        setTimeout(() => {
                            if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                                connection.destroy();
                            }
                        }, 2000);
                    }

                    // Cleanup temp files
                    try {
                        if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
                        if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
                    } catch (e) {}
                }
            });
            
        } catch (err) {
            logger.info('Encountered an error speaking: ', err);
            if (musicQueue) musicQueue.player.unpause(); // Emergency resume
            
            // Cleanup on error
            try {
                if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
                if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
            } catch (e) {}
        }
	},
};
