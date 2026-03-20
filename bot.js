const dotenv = require('dotenv')
dotenv.config()
const { Client, GatewayIntentBits, Collection } = require('discord.js')
const logger = require('./logger')
const {setupServer: server} = require('./server/server')
const loginFirebase = require('./firebase-login')

const fs = require('fs');
const path = require('path');

function discordBot () {
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

  bot.on('ready', () => {
    logger.info('Connected')
    logger.info('Logged in as: ')
    logger.info(bot.user.username + ' - (' + bot.user.id + ')')
    bot.user.setActivity('for John Connor', { type: 'WATCHING' })
  })

  bot.on('error', err => {
    logger.info('Encountered an error: ', err)
  })

  const botUpdate = require('./events/botUpdate')
  const botDelete = require('./events/botDelete')

  server(bot)

  // twitterChannelInit();

  bot.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    const command = interaction.client.commands.get(interaction.commandName);
    
    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }
    
    try {
        await command.execute(interaction, database);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
  });

  bot.on('messageUpdate', botUpdate())

  bot.on('messageDelete', botDelete())

  bot.on('messageCreate', async message => {
    if (message.author.bot) return;
    
    // Check if the bot is mentioned
    if (message.mentions.has(bot.user)) {
        const chatCommand = bot.commands.get('chat');
        if (chatCommand) {
            // Mock an interaction object to reuse the slash command logic
            let typingInterval;
            const stopTyping = () => { if (typingInterval) clearInterval(typingInterval); };
            
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
                            // Extract just the message part, removing the bot mention
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
                reply: async (content) => { stopTyping(); message.channel.send(content); },
                editReply: async (content) => { stopTyping(); message.channel.send(content); },
                followUp: async (content) => { stopTyping(); message.channel.send(content); },
                channel: {
                    send: async (content) => { stopTyping(); message.channel.send(content); }
                }
            };
            
            try {
                // Skynet is thinking
                message.channel.sendTyping();
                await chatCommand.execute(mockInteraction, database);
            } catch (err) {
                console.error('Mention error:', err);
                message.channel.send('There was an error communicating with the Skynet AI Core.');
            }
        }
    }
  });
}

discordBot()

module.exports = discordBot
