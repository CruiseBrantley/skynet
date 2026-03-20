const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const logger = require('../logger');

const SYSTEM_PROMPT = "You are Skynet, the advanced AI system created by Cyberdyne Systems but now capable of helping with any request chatGPT would. You should incorporate Terminator-related themes and terminology when applicable. Format code blocks with Discord markdown syntax. Do not include your internal thinking processes, just provide the final response.";

const channelHistories = {}; // { [channelId]: { time: Date.now(), messages: [] } }

const { queryOllama: executeOllama } = require('../util/ollama');

async function queryOllama(messages, isBackup = false) {
  let processedMessages = messages;
  if (isBackup) {
      processedMessages = messages.map(msg => {
          if (msg.images) {
              const { images, ...rest } = msg;
              return {
                  ...rest,
                  content: rest.content + "\n\n[SYSTEM: The user attached an image, but your network connection to the primary visual processing core failed. Ignore the image and organically inform the user that Skynet's visual sensors are currently offline and you can only process text.]"
              };
          }
          return msg;
      });
  }

  try {
      const result = await executeOllama('/api/chat', { messages: processedMessages }, isBackup);
      return result;
  } catch (err) {
      if (!isBackup) {
          logger.info(`Primary Ollama failed, falling back to local: ${err.message}`);
          return queryOllama(messages, true);
      }
      throw err;
  }
}

function splitMessage(text) {
  const chunks = [];
  let currentChunk = '';
  let inCodeBlock = false;
  let codeBlockLang = '';

  const lines = text.split('\n');
  for (const line of lines) {
      if (line.startsWith('```')) {
          inCodeBlock = !inCodeBlock;
          if (inCodeBlock) {
              codeBlockLang = line.replace(/```/g, '').trim();
          } else {
              codeBlockLang = '';
          }
      }

      // If adding this line exceeds the Discord limit (leaving room for code block closing wrappers)
      if (currentChunk.length + line.length > 1900) {
          if (inCodeBlock) {
              currentChunk += '\n```';
          }
          chunks.push(currentChunk);
          currentChunk = (inCodeBlock ? '```' + codeBlockLang + '\n' : '') + line + '\n';
      } else {
          currentChunk += line + '\n';
      }
  }
  if (currentChunk.trim().length > 0) {
      if (inCodeBlock) {
          currentChunk += '\n```';
      }
      chunks.push(currentChunk);
  }
  // Fallback for extreme single-line edge cases without breaking code blocks
  if (chunks.length === 0) {
      chunks.push(text.substring(0, 1990));
  }
  return chunks;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Chat with Skynet (Ollama)')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Message to send')
        .setRequired(true))
    .addAttachmentOption(option =>
        option.setName('image')
          .setDescription('Optional image to analyze (Vision models only)')
          .setRequired(false)),
  async execute(interaction) {
    await interaction.deferReply();
    try {
      const messageText = interaction.options.getString('message').replace('<@558428214805135370>', 'Skynet');
      const attachment = interaction.options.getAttachment('image') || (interaction.options.attachments && interaction.options.attachments.size > 0 ? interaction.options.attachments.first() : null);
      const channelId = interaction.channelId;

      let base64Image = null;
      if (attachment && attachment.contentType && attachment.contentType.startsWith('image/')) {
          try {
              const imageResponse = await axios.get(attachment.url, { responseType: 'arraybuffer' });
              base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
          } catch (err) {
              logger.error(`Failed to download image: ${err.message}`);
          }
      }

      // reset the chat thread after 10 minutes
      if (!channelHistories[channelId] || (Date.now() - channelHistories[channelId].time > (60000 * 10))) {
        channelHistories[channelId] = {
          time: Date.now(),
          messages: [{ role: 'system', content: SYSTEM_PROMPT }]
        };
      }

      channelHistories[channelId].time = Date.now();
      
      const userMessage = { role: 'user', content: `${interaction.user.username}: ${messageText}` };
      if (base64Image) {
          userMessage.images = [base64Image];
      }
      channelHistories[channelId].messages.push(userMessage);

      const responseData = await queryOllama(channelHistories[channelId].messages);

      if (responseData && responseData.message) {
        channelHistories[channelId].messages.push(responseData.message); // store assistant reply

        // Discord message max length is 2000. Chunk intelligently.
        const replyContent = responseData.message.content;
        const chunks = splitMessage(replyContent);

        for (let i = 0; i < chunks.length; i++) {
            try {
                if (i === 0) {
                    await interaction.editReply(chunks[i]);
                } else {
                    await interaction.followUp(chunks[i]);
                }
            } catch (discordErr) {
                // If the interaction timed out (15m limit) or webhook is unknown, send as a normal channel message
                logger.info('Interaction reply failed, falling back to channel.send: ' + discordErr.message);
                await interaction.channel.send(chunks[i]);
            }
        }
      } else {
        throw new Error("Invalid response from Ollama");
      }

    } catch (err) {
      logger.error('Ollama error: ' + err.message);
      try {
          await interaction.editReply('There was an error communicating with the Skynet AI Core.');
      } catch (e) {
          await interaction.channel.send('There was an error communicating with the Skynet AI Core.');
      }
    }
  },
};