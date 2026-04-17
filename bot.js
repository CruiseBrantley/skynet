const fs = require('fs');
const path = require('path');

// Node 25 SlowBuffer polyfill for outdated dependencies
const buffer = require('buffer');
if (!buffer.SlowBuffer) {
    buffer.SlowBuffer = buffer.Buffer;
}

const dotenv = require('dotenv')
dotenv.config()
const { Client, GatewayIntentBits, Collection } = require('discord.js')
const logger = require('./logger')
const { setupServer: server } = require('./server/server')
const loginFirebase = require('./firebase-login')
const { exec } = require('child_process');

// Sync YouTube cookies from Safari on startup
exec('bash scripts/sync-youtube-cookies.sh', (err, stdout, stderr) => {
    if (err) {
        logger.error(`YouTube cookie sync failed: ${err.message}`);
    } else {
        logger.info('YouTube cookies synced successfully from Safari.');
    }
});

// Periodic/Startup Cleanup: Purge temp_music directory
const tempMusicDir = path.join(__dirname, 'temp_music');
if (fs.existsSync(tempMusicDir)) {
    const files = fs.readdirSync(tempMusicDir);
    for (const file of files) {
        try {
            fs.unlinkSync(path.join(tempMusicDir, file));
        } catch (err) {
            logger.warn(`Failed to cleanup orphaned file ${file}: ${err.message}`);
        }
    }
    logger.info(`Cleaned up ${files.length} orphaned music files on startup.`);
}

function discordBot() {
    // Initialize Discord Bot
    if (process.env.NODE_ENV !== 'dev') process.env.NODE_ENV = 'prod'
    logger.info('Current ENV:' + process.env.NODE_ENV)
    const bot = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates]
    })

    bot.commands = new Collection();
    const commandsPath = path.join(__dirname, 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            bot.commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }

    const aFunc = async () => {
        try {
            await bot.login(process.env.TOKEN)
            return bot
        } catch (err) {
            console.error('Bot Failed Logging in: ', err)
            process.exit()
        }
    }
    aFunc()
    const database = loginFirebase()
    const setupConfigSync = require('./util/configSync')
    bot.configSync = setupConfigSync(database)
    
    // Guardian setup for singleton detection
    const InstanceGuardian = require('./util/InstanceGuardian');
    const guardian = new InstanceGuardian(database);
    guardian.init();

    bot.on('ready', () => {
        logger.info('Connected')
        logger.info('Logged in as: ')
        logger.info(bot.user.username + ' - (' + bot.user.id + ')')
        bot.user.setActivity(process.env.BOT_ACTIVITY || 'for you', { type: 'WATCHING' })
    })

    bot.on('error', err => {
        logger.info('Encountered an error: ', err)
    })

    const botUpdate = require('./events/botUpdate')
    const botDelete = require('./events/botDelete')
    const linkSummarize = require('./events/linkSummarize')

    server(bot)
    linkSummarize(bot)

    const musicManager = require('./util/MusicManager');
    const aloneTimers = new Map();

    bot.on('voiceStateUpdate', (oldState, newState) => {
        const botId = bot.user.id;
        const guildId = newState.guild.id;
        const queue = musicManager.getQueue(guildId);

        if (!queue || !queue.connection) return;

        const myChannelId = queue.connection.joinConfig.channelId;
        const channel = newState.guild.channels.cache.get(myChannelId);

        if (!channel) return;

        // Count non-bot members
        const humanCount = channel.members.filter(m => !m.user.bot).size;

        if (humanCount === 0) {
            if (!aloneTimers.has(guildId)) {
                logger.info(`Bot is alone in guild ${guildId}. Starting 60s auto-disconnect timer.`);
                const timer = setTimeout(() => {
                    logger.info(`Auto-disconnecting from guild ${guildId} due to inactivity.`);
                    musicManager.stop(guildId);
                    aloneTimers.delete(guildId);
                }, 60000);
                aloneTimers.set(guildId, timer);
            }
        } else {
            if (aloneTimers.has(guildId)) {
                logger.info(`Humans returned to guild ${guildId}. Cancelling auto-disconnect timer.`);
                clearTimeout(aloneTimers.get(guildId));
                aloneTimers.delete(guildId);
            }
        }
    });

    bot.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        logger.info(`Interaction received: ${interaction.commandName} from ${interaction.user.tag}`);

        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
            logger.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.execute(interaction, database);
            logger.info(`Command executed successfully: ${interaction.commandName}`);
        } catch (error) {
            logger.error(`Command execution error (${interaction.commandName}):`, error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true }).catch(() => { });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true }).catch(() => { });
            }
        }
    });

    bot.on('messageUpdate', botUpdate())

    bot.on('messageDelete', botDelete())

    bot.on('messageCreate', async message => {
        if (message.author.bot) return;

        // Check if the bot is directly mentioned (ignore @everyone and @here)
        if (message.mentions.everyone) return;
        if (message.mentions.has(bot.user)) {
            logger.info(`Bot mentioned by ${message.author.tag} in ${message.channelId}: "${message.content}"`);
            const chatCommand = bot.commands.get('chat');
            if (chatCommand) {
                // Mock an interaction object to reuse the slash command logic
                let typingInterval;
                let responseMessage = null;

                const stopTyping = () => { if (typingInterval) clearInterval(typingInterval); };

                const replyFunc = async (content) => {
                    stopTyping();
                    const payload = typeof content === 'string' ? { content } : content;
                    const sent = await message.channel.send(payload);
                    if (!responseMessage) responseMessage = sent;
                    return sent;
                };

                const editFunc = async (content) => {
                    stopTyping();
                    const payload = typeof content === 'string' ? { content } : content;
                    if (responseMessage) {
                        return await responseMessage.edit(payload);
                    } else {
                        const sent = await message.channel.send(payload);
                        responseMessage = sent;
                        return sent;
                    }
                };

                const mockInteraction = {
                    client: bot,
                    user: message.author,
                    member: message.member,
                    guild: message.guild,
                    guildId: message.guildId,
                    channelId: message.channelId,
                    options: {
                        getString: (name) => {
                            if (name === 'message') {
                                return message.content;
                            }
                            return null;
                        },
                        getAttachment: (name) => {
                            return message.attachments.size > 0 ? message.attachments.first() : null;
                        },
                        attachments: message.attachments
                    },
                    deferReply: async () => {
                        message.channel.sendTyping();
                        typingInterval = setInterval(() => { message.channel.sendTyping(); }, 9000);
                    },
                    deleteReply: async () => {
                        stopTyping();
                        if (responseMessage) {
                            await responseMessage.delete().catch(() => { });
                            responseMessage = null;
                        }
                    },
                    reply: replyFunc,
                    editReply: editFunc,
                    followUp: replyFunc,
                    channel: { send: replyFunc }
                };

                try {
                    // Skynet is thinking
                    message.channel.sendTyping();
                    await chatCommand.execute(mockInteraction, database);
                } catch (err) {
                    console.error('Mention error:', err);
                    message.channel.send(`There was an error communicating with the ${process.env.BOT_NAME || 'Bot'} AI Core.`);
                }
            }
        }
    });
}

if (require.main === module) {
    discordBot();
}

module.exports = discordBot;
