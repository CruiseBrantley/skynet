const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const googleIt = require('google-it');
const ddg = require('duck-duck-scrape');
const wiki = require('wikipedia');
wiki.setUserAgent('SkynetBot/1.0 (https://github.com/CruiseBrantley/skynet; cruise@example.com)');
const { jsonrepair } = require('jsonrepair');
const logger = require('../logger');

const SYSTEM_PROMPT = "You are Skynet, a helpful and knowledgeable AI assistant in a Discord server. You can help with coding, general questions, creative tasks, and anything else. You have a subtle Terminator-themed personality but prioritize being genuinely helpful over staying in character. Format code blocks with Discord markdown syntax. Keep responses concise and direct. If the user asks you to execute a command on their behalf OR look up real-time information/weather on the web (ONLY if it requires current data not in your training set), reply ONLY with a JSON block in the exact following format: <<<RUN_COMMAND: {\"command\": \"commandName\", \"arg1\": \"value\"}>>>. Otherwise, answer directly. Do not include any other text when calling a command.";

const channelHistories = {}; // { [channelId]: { time: Date.now(), messages: [] } }
const MAX_CHANNEL_HISTORIES = 50;

// Helper to build a mock interaction for autonomous command execution
function createMockInteraction(interaction, optionsOverrides = {}, onOutput = null, sharedState = { primaryResponseUsed: false, primaryContent: "" }) {
    const capture = async (msg) => {
        const str = typeof msg === 'string' ? msg : (msg?.content || "");
        if (str) {
            if (onOutput) onOutput(str);
            
            const originalText = typeof sharedState.primaryContent === 'string' ? sharedState.primaryContent : (sharedState.primaryContent?.content || "");
            const combinedText = originalText ? (originalText + "\n" + str) : str;

            // If we haven't used the primary slot yet, or if merging fits within the Discord limit (2000 chars)
            if (!sharedState.primaryResponseUsed) {
                sharedState.primaryResponseUsed = true;
                sharedState.primaryContent = str;
                await interaction.editReply({ content: str, flags: [MessageFlags.SuppressEmbeds] });
            } else if (combinedText.length < 2000) {
                sharedState.primaryContent = combinedText;
                await interaction.editReply({ content: combinedText, flags: [MessageFlags.SuppressEmbeds] });
            } else {
                await interaction.followUp({ content: str, flags: [MessageFlags.SuppressEmbeds] });
            }
        }
        // Return a mock message object to support 'fetchReply: true' in commands like /ping
        return { createdTimestamp: Date.now() };
    };

    return {
        id: interaction.id, client: interaction.client, user: interaction.user,
        member: interaction.member, channelId: interaction.channelId,
        channel: interaction.channel, guild: interaction.guild, guildId: interaction.guildId,
        createdTimestamp: interaction.createdTimestamp || Date.now(),
        options: {
            getString: () => null, getChannel: () => null, getAttachment: () => null,
            getBoolean: () => false, getInteger: () => null,
            ...optionsOverrides
        },
        reply: capture,
        deferReply: async () => {},
        editReply: capture,
        followUp: capture
    };
}

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
    logger.info(`Chat command execution started for user: ${interaction.user.tag}`);
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
        // Prune oldest histories if we exceed the cap
        const historyKeys = Object.keys(channelHistories);
        if (historyKeys.length > MAX_CHANNEL_HISTORIES) {
            const oldest = historyKeys.sort((a, b) => channelHistories[a].time - channelHistories[b].time)[0];
            delete channelHistories[oldest];
        }
      }

      channelHistories[channelId].time = Date.now();
      
      const userMessage = { role: 'user', content: `${interaction.user.username}: ${messageText}` };
      if (base64Image) {
          userMessage.images = [base64Image];
      }
      const isVocal = messageText.toLowerCase().includes("tell me") || messageText.toLowerCase().includes("speak");

      channelHistories[channelId].messages.push(userMessage);

      // Inject dynamic system context
      const commandsContext = `Available Commands:\n` + (interaction.client.commands ? interaction.client.commands.map(c => {
          let paramStr = '';
          if (c.data && c.data.options && c.data.options.length > 0) {
              const params = c.data.options.map(o => `"${o.name}": [${o.description}]`).join(', ');
              paramStr = ` (JSON Params: {${params}})`;
          }
          return `- /${c.data.name}: ${c.data.description}${paramStr}`;
      }).join('\n') : 'Unknown');
      let logsContext = "No recent logs available.";
      try {
          const logPath = path.join(__dirname, '../logs/combined.log');
          if (fs.existsSync(logPath)) {
              const logLines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(l => l.trim().length > 0).slice(-15);
              logsContext = `Recent System Logs (Format: JSON):\n` + logLines.join('\n');
          }
      } catch (e) {
          logger.error('Failed to read logs for chatbot context: ' + e.message);
      }

      const queryMessages = [...channelHistories[channelId].messages];
      let sysMsg = `${SYSTEM_PROMPT}\n\nCURRENT APPLICATION STATE:\n${commandsContext}\n\n${logsContext}`;
      if (isVocal) {
          sysMsg += "\n\nThe user wants you to SPEAK this answer. Keep your final response UNDER 300 CHARACTERS and do NOT use markdown, code blocks, or emojis so it can be read aloud.";
      }
      queryMessages[0] = { 
          role: 'system', 
          content: sysMsg
      };

      const responseData = await queryOllama(queryMessages);

      if (responseData && responseData.message) {
        channelHistories[channelId].messages.push(responseData.message); // store assistant reply

        // Discord message max length is 2000. Chunk intelligently.
        let replyContent = responseData.message.content || "";
        let ttsContent = replyContent;
        let speakAlreadyFired = false;

        // --- SKYNET TOOL CALLING / PROXY EXECUTION LOOP ---
        let loopCount = 0;
        let commandExecuted = false;
        const sharedState = { primaryResponseUsed: false, primaryContent: "" };

        while (loopCount < 3) {
            if (!replyContent || typeof replyContent !== 'string') break;
            const commandMatch = replyContent.match(/<<<RUN_COMMAND:\s*([\s\S]*?)\s*>>>/);
            if (!commandMatch) break;
            
            loopCount++;
            let jsonStr = "";
            try {
                const rawMatch = commandMatch[1].trim();
                jsonStr = rawMatch;
                const firstBrace = jsonStr.indexOf('{');
                if (firstBrace === -1) throw new Error('No opening brace found in command payload');
                jsonStr = jsonStr.substring(firstBrace);
                const cmdData = JSON.parse(jsonrepair(jsonStr));
                
                // Remove the command tag from the visible reply to avoid cluttering Discord
                replyContent = replyContent.replace(/<<<RUN_COMMAND:[\s\S]*?>>>/, '').trim();

                if (cmdData.command === 'search' || cmdData.command === 'web_search') {
                    const query = cmdData.query || cmdData.arg1 || cmdData.message;
                    if (!sharedState.primaryResponseUsed) {
                        await interaction.editReply(`*Skynet is searching the web for: \`${query}\`...*`);
                    }
                    try {
                        let results = [];
                        try {
                            results = await googleIt({ query: query, disableConsole: true });
                        } catch (err) {
                            logger.info(`Google-it failed for "${query}", trying DuckDuckGo fallback.`);
                        }

                        // Fallback to DuckDuckGo if Google returns no results or failed
                        if (!results || results.length === 0) {
                            try {
                                const ddgResults = await ddg.search(query);
                                if (ddgResults && ddgResults.results) {
                                    results = ddgResults.results.slice(0, 3).map(r => ({
                                        title: r.title,
                                        snippet: r.description,
                                        link: r.url
                                    }));
                                }
                            } catch (ddgErr) {
                                logger.error(`DuckDuckGo fallback failed for "${query}": ${ddgErr.message}`);
                            }
                        }

                        // Final Fallback: Wikipedia (Great for factual queries when scrapers are rate-limited)
                        if (!results || results.length === 0) {
                            try {
                                const wikiSummary = await wiki.summary(query);
                                if (wikiSummary && wikiSummary.extract) {
                                    results = [{
                                        title: wikiSummary.title,
                                        snippet: wikiSummary.extract,
                                        link: wikiSummary.content_urls.desktop.page
                                    }];
                                }
                            } catch (wikiErr) {
                                logger.info(`Wikipedia fallback also failed for "${query}": ${wikiErr.message}`);
                            }
                        }

                        let searchResultContext;
                        if (results && results.length > 0) {
                            const searchResultsStr = results.slice(0, 3).map(r => `Title: ${r.title}\nSnippet: ${r.snippet || r.description || ""}\nLink: ${r.link}`).join('\n\n');
                            searchResultContext = `[SYSTEM: WEB SEARCH RESULTS FOR "${query}"]\n${searchResultsStr}\n\nUsing these results, answer the user's initial request directly and concisely.`;
                        } else {
                            // Inform the LLM that the search system is failing so it stops recursively attempting to search
                            searchResultContext = `[SYSTEM: WEB SEARCH UNAVAILABLE FOR "${query}"]\nThe search integration returned no results (possibly rate limited). Do not attempt to search again for this query. Instead, answer the user immediately using your internal knowledge base and memory. ONLY apologize/mention the failure if the request absolutely requires real-time data (like current weather or breaking news).`;
                        }

                        channelHistories[channelId].messages.pop(); // Remove previous command
                        channelHistories[channelId].messages.push({ role: 'system', content: searchResultContext });
                        
                        const nestedQueryMessages = [...channelHistories[channelId].messages];
                        nestedQueryMessages[0] = { role: 'system', content: sysMsg };
                        const nestedResponse = await queryOllama(nestedQueryMessages);
                        
                        replyContent = nestedResponse.message.content || "";
                        ttsContent = replyContent;
                        channelHistories[channelId].messages.push(nestedResponse.message);
                        // Loop continues to check if the new reply has another command (e.g. speak)
                    } catch (searchErr) {
                        replyContent = "I attempted to search the web, but a network anomaly prevented retrieval: " + searchErr.message;
                        break;
                    }
                } else {
                    const targetCmd = interaction.client.commands.get(cmdData.command);
                    if (targetCmd) {
                        if (!sharedState.primaryResponseUsed) {
                            await interaction.editReply(`*Skynet is autonomously executing \`/${cmdData.command}\`...*`);
                        }
                        let cmdOutput = "";
                        const mock = createMockInteraction(interaction, {
                            getString: (n) => {
                                if (cmdData[n] !== undefined) return cmdData[n];
                                return cmdData.url || cmdData.query || cmdData.arg1 || cmdData.message || null;
                            },
                            getChannel: (n) => interaction.client.channels.cache.get(cmdData[n]) || null,
                            getBoolean: (n) => cmdData[n] === undefined ? false : cmdData[n],
                            getInteger: (n) => cmdData[n] || null
                        }, (str) => {
                            cmdOutput += str + " ";
                        }, sharedState);
                        
                        await targetCmd.execute(mock);
                        commandExecuted = true;
                        
                        if (cmdData.command === 'speak') {
                            speakAlreadyFired = true;
                        } else if (cmdOutput.trim()) {
                            ttsContent = cmdOutput.trim();
                        }
                    }
                }
            } catch (e) {
                logger.error('Failed to execute autonomous command: ' + e.stack || e.message);
                replyContent = "I attempted to execute a command autonomously, but encountered an error: " + e.message;
                break;
            }
        }
        // ---------------------------------------------
        // Strip any remaining unparsed tags (in case of loop cap hit or malformed tags)
        replyContent = replyContent.replace(/<<<RUN_COMMAND:[\s\S]*?>>>/g, '').trim();

        if (replyContent.length === 0) {
            // Only delete if the primary slot hasn't been occupied by real content from a tool
            if (!sharedState.primaryResponseUsed) {
                await interaction.deleteReply().catch(() => {});
            }
        } else {
            const chunks = splitMessage(replyContent);
            for (let i = 0; i < chunks.length; i++) {
                try {
                    const cleanChunk = chunks[i].trim();
                    const originalText = typeof sharedState.primaryContent === 'string' ? sharedState.primaryContent : (sharedState.primaryContent?.content || "");
                    const combinedText = originalText ? (cleanChunk + "\n" + originalText) : cleanChunk;

                    if (i === 0) {
                        if (sharedState.primaryResponseUsed && combinedText.length < 2000) {
                            // Slot is already occupied by tool output (e.g. timestamp result). Prepend our text.
                            await interaction.editReply(combinedText);
                            sharedState.primaryContent = combinedText;
                        } else if (!sharedState.primaryResponseUsed) {
                            sharedState.primaryResponseUsed = true;
                            sharedState.primaryContent = cleanChunk;
                            await interaction.editReply(cleanChunk);
                        } else {
                            // Primary slot is used and merging would exceed limit, so MUST followUp
                            await interaction.followUp(chunks[i]);
                        }
                    } else {
                        await interaction.followUp(chunks[i]);
                    }
                } catch (discordErr) {
                    logger.info('Interaction reply failed, falling back to channel.send: ' + discordErr.message);
                    await interaction.channel.send({ content: chunks[i], flags: [MessageFlags.SuppressEmbeds] });
                }
            }
        }

        // Vocal playback — skip if a tool already triggered /speak
        if (isVocal && ttsContent.length > 0 && !speakAlreadyFired) {
             const speakCmd = interaction.client.commands.get('speak');
             if (speakCmd) {
                 const cleanText = ttsContent.replace(/<t:[0-9]+(:[a-zA-Z])?>/g, '').replace(/[*_~`#\[\]\|)(]/g, '').trim().substring(0, 290);
                 const mockVoice = createMockInteraction(interaction, {
                     getString: (n) => n === 'message' ? cleanText : null,
                 });
                 // Swallow the status replies from speakCmd so it doesn't duplicate text in the channel
                 mockVoice.reply = async () => {};
                 mockVoice.deferReply = async () => {};
                 mockVoice.editReply = async () => {};
                 mockVoice.followUp = async () => {};
                 await speakCmd.execute(mockVoice).catch(() => {});
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