const fs = require('fs');
const path = require('path');

// Node 25 SlowBuffer polyfill for outdated dependencies
const buffer = require('buffer');
if (!buffer.SlowBuffer) {
  buffer.SlowBuffer = buffer.Buffer;
}

const dotenv = require('dotenv');
dotenv.config();
const {
  Client,
  GatewayIntentBits,
  Collection,
  Partials,
  ChannelType,
} = require('discord.js');
const logger = require('./logger');
const { setupServer: server } = require('./server/server');
const loginFirebase = require('./firebase-login');
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

// Initialize Discord Bot
if (process.env.NODE_ENV !== 'dev') process.env.NODE_ENV = 'prod';
logger.info('Current ENV:' + process.env.NODE_ENV);

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.GuildMember,
    Partials.User,
    Partials.Reaction,
  ],
});

// Proactive DM channel caching fix for Discord.js v14
bot.on('raw', async (packet) => {
  if (packet.t === 'MESSAGE_CREATE' && !packet.d.guild_id) {
    try {
      if (!bot.channels.cache.has(packet.d.channel_id)) {
        await bot.channels.fetch(packet.d.channel_id);
      }
    } catch (e) {
      logger.error(`DM pre-fetch failed: ${e.message}`);
    }
  }
});

bot.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith('.js') && file !== 'chat.js');

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    bot.commands.set(command.data.name, command);
  } else {
    console.log(
      `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
    );
  }
}

const database = loginFirebase();
const setupConfigSync = require('./util/configSync');
bot.configSync = setupConfigSync(database);

// Guardian setup for singleton detection
const InstanceGuardian = require('./util/InstanceGuardian');
const guardian = new InstanceGuardian(database);
guardian.init();

const musicManager = require('./util/MusicManager');
const agentScheduler = require('./util/AgentScheduler');
const agentLoop = require('./util/AgentLoop');
const botUpdate = require('./events/botUpdate');
const botDelete = require('./events/botDelete');

const aloneTimers = new Map();

bot.on('ready', () => {
  logger.info('Connected');
  logger.info('Logged in as: ');
  logger.info(bot.user.username + ' - (' + bot.user.id + ')');
  bot.user.setActivity(process.env.BOT_ACTIVITY || 'for you', {
    type: 'WATCHING',
  });

  // Start the agent task scheduler tick (60-second interval)
  if (!bot._schedulerRunning) {
    bot._schedulerRunning = true;
    logger.info('AgentScheduler: Tick started (60s interval).');
    setInterval(() => agentScheduler.processDueTasks(bot), 60_000);
  }

  // Start the background agent loop
  if (!bot._agentLoopStarted) {
    bot._agentLoopStarted = true;
    const loopInterval =
      parseInt(process.env.AGENT_LOOP_INTERVAL_MS) || 5 * 60_000;
    agentLoop.start(bot, loopInterval);
  }

  // Start the web server
  try {
    server(bot, database);
  } catch (err) {
    logger.error(`Failed to start web server: ${err.message}`);
  }
});

bot.on('error', (err) => {
  logger.error('Discord error: ' + err.message);
});

bot.on('voiceStateUpdate', (oldState, newState) => {
  const botId = bot.user.id;
  const guildId = newState.guild.id;
  const queue = musicManager.getQueue(guildId);

  if (!queue || !queue.connection) return;

  const myChannelId = queue.connection.joinConfig.channelId;
  const channel = newState.guild.channels.cache.get(myChannelId);

  if (!channel) return;

  // Count non-bot members
  const humanCount = channel.members.filter((m) => !m.user.bot).size;

  if (humanCount === 0) {
    if (!aloneTimers.has(guildId)) {
      logger.info(
        `Bot is alone in guild ${guildId}. Starting 60s auto-disconnect timer.`,
      );
      const timer = setTimeout(() => {
        logger.info(
          `Auto-disconnecting from guild ${guildId} due to inactivity.`,
        );
        musicManager.stop(guildId);
        aloneTimers.delete(guildId);
      }, 60000);
      aloneTimers.set(guildId, timer);
    }
  } else {
    if (aloneTimers.has(guildId)) {
      logger.info(
        `Humans returned to guild ${guildId}. Cancelling auto-disconnect timer.`,
      );
      clearTimeout(aloneTimers.get(guildId));
      aloneTimers.delete(guildId);
    }
  }
});

bot.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command || !command.autocomplete) return;
    try {
      await command.autocomplete(interaction);
    } catch (error) {
      logger.error(`Autocomplete error: ${error.message}`);
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);

  if (!command) {
    logger.warn(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction, database);
  } catch (error) {
    logger.error(`Slash command error: ${error.stack || error.message}`);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: 'There was an error while executing this command!',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: 'There was an error while executing this command!',
        ephemeral: true,
      });
    }
  }
});

bot.on('messageUpdate', botUpdate());
bot.on('messageDelete', botDelete());

bot.on('threadCreate', async (thread) => {
  try {
    // Auto-join if the thread was created from one of our messages
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter?.author.id === bot.user.id) {
      await thread.join();
      logger.info(
        `Auto-joined thread: ${thread.name} (Started from our message)`,
      );
    }
  } catch (e) {
    logger.error(`Error auto-joining thread: ${e.message}`);
  }
});

bot.on('messageCreate', async (message) => {
  try {
    if (message.partial) await message.fetch();
    if (message.channel?.partial) await message.channel.fetch();

    if (message.author?.bot) return;

    const isDM =
      !message.guild ||
      message.channel?.type === ChannelType.DM ||
      message.channel?.isDMBased?.();
    const isMentioned = message.mentions.has(bot.user);
    const isThread = message.channel?.isThread?.() || false;

    if (isDM || isMentioned) {
      logger.info(
        `Message Debug [${message.author?.tag}]: channelId=${message.channelId}, isDM=${isDM}, isMentioned=${isMentioned}`,
      );
    }

    // Skip messages sent more than 10 minutes ago
    if (Date.now() - message.createdAt.getTime() > 10 * 60 * 1000) {
      return;
    }

    if (message.mentions.everyone) return;

    let shouldRespond = isMentioned || isDM;

    if (!shouldRespond && isThread) {
      let isOurThread = false;
      try {
        const threadMembers = await message.channel.members
          .fetch()
          .catch(() => new Collection());
        isOurThread =
          threadMembers.has(bot.user.id) ||
          message.channel.ownerId === bot.user.id;

        if (!isOurThread) {
          // Secondary check: was this thread started from one of our messages?
          const starter = await message.channel
            .fetchStarterMessage()
            .catch(() => null);
          if (starter?.author.id === bot.user.id) {
            isOurThread = true;
            await message.channel.join().catch(() => {});
          }
        }
      } catch (e) {
        logger.error(`Error checking thread membership: ${e.message}`);
      }

      if (isOurThread) {
        const recentMessages = await message.channel.messages.fetch({
          limit: 5,
        });
        const context = recentMessages
          .reverse()
          .map((m) => `${m.author.username}: ${m.content}`)
          .join('\n');
        const botName = process.env.BOT_NAME || 'Skynet';

        const containsName = message.content
          .toLowerCase()
          .includes(botName.toLowerCase());
        const isQuestion = message.content.includes('?');
        const lastWasBot = recentMessages.last()?.author.id === bot.user.id;

        if (containsName || (isQuestion && lastWasBot)) {
          shouldRespond = true;
        } else {
          const { queryLocalOrRemote } = require('./util/ollama');
          const decision = await queryLocalOrRemote('/api/chat', {
            messages: [
              {
                role: 'system',
                content: `You are ${botName}. Decide if you should respond to the current thread. Respond only with YES or NO.`,
              },
              {
                role: 'user',
                content: `[THREAD CONTEXT]\n${context}\n\nShould I respond?`,
              },
            ],
            options: { temperature: 0, num_predict: 5 },
          }).catch(() => ({ message: { content: 'NO' } }));

          if (decision?.message?.content?.toUpperCase().includes('YES')) {
            shouldRespond = true;
          }
        }
      }
    }

    if (shouldRespond) {
      logger.info(
        `Bot EXECUTING for ${message.author.tag} in ${isThread ? 'Thread' : isDM ? 'DM' : message.channelId}`,
      );
      const chatCommand = require('./commands/chat.js');
      if (chatCommand) {
        let typingInterval;
        let responseMessage = null;
        const stopTyping = () => {
          if (typingInterval) clearInterval(typingInterval);
        };

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
          id: `autonomous-${Date.now()}`,
          client: bot,
          user: message.author,
          member: message.member,
          guild: message.guild,
          guildId: message.guildId,
          channelId: message.channelId,
          channel: message.channel,
          options: {
            getString: (name) => (name === 'message' ? message.content : null),
            getAttachment: (name) =>
              message.attachments.size > 0 ? message.attachments.first() : null,
            attachments: message.attachments,
          },
          deferReply: async () => {
            message.channel.sendTyping();
            typingInterval = setInterval(() => {
              message.channel.sendTyping();
            }, 9000);
          },
          deleteReply: async () => {
            stopTyping();
            if (responseMessage) {
              await responseMessage.delete().catch(() => {});
              responseMessage = null;
            }
          },
          reply: replyFunc,
          editReply: editFunc,
          followUp: replyFunc,
        };

        try {
          message.channel.sendTyping();
          await chatCommand.execute(mockInteraction, database);
        } catch (err) {
          logger.error(`Mention error: ${err.stack || err.message}`);
          message.channel.send(
            `There was an error communicating with the ${process.env.BOT_NAME || 'Bot'} AI Core.`,
          );
        } finally {
          stopTyping();
        }
      }
    }
  } catch (err) {
    logger.error(
      `Message handler fatal error for ${message.author?.tag || 'unknown'}: ${err.stack || err.message}`,
    );
  }
});

bot.login(process.env.TOKEN).catch((err) => {
  logger.error('Bot Failed Logging in: ' + err.message);
  process.exit(1);
});

module.exports = bot;
