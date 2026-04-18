const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const googleIt = require('google-it');
const ddg = require('duck-duck-scrape');
const wiki = require('wikipedia');
const botName = process.env.BOT_NAME || 'Bot';
wiki.setUserAgent(`${botName}Bot/1.0`);
const puppeteerSearch = require('../util/puppeteerSearch');
const { fetchPageText } = require('../util/summarize');
const { jsonrepair } = require('jsonrepair');
const logger = require('../logger');

// Load system prompt from config file, falling back to a generic default
let SYSTEM_PROMPT;
try {
    SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '../config/system_prompt.txt'), 'utf8').trim();
} catch (err) {
    SYSTEM_PROMPT = `You are ${botName}, a helpful AI assistant in a Discord server. Format code blocks with Discord markdown syntax. Keep responses concise and direct.`;
}

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
            getMember: () => null, getUser: () => null,
            ...optionsOverrides
        },
        reply: capture,
        deferReply: async () => {},
        editReply: capture,
        followUp: capture
    };
}

const { queryOllama: executeOllama } = require('../util/ollama');

async function queryOllama(messages, isBackup = false, commandsContext = "", logsContext = "") {
  let sysMsg = `${SYSTEM_PROMPT}\n\nCURRENT SYSTEM DATE & TIME:\n${new Date().toLocaleString('en-US', { timeZoneName: 'short' })}\n\nCURRENT APPLICATION STATE:\n${commandsContext}\n\n${logsContext}`;

  let processedMessages = messages.map((msg, idx) => {
      if (idx === 0 && msg.role === 'system') {
          return { ...msg, content: sysMsg };
      }
      if (isBackup && msg.images) {
          const { images, ...rest } = msg;
          return {
              ...rest,
              content: (rest.content || "") + `\n\n[SYSTEM: The user attached an image, but your network connection to the primary visual processing core failed. Ignore the image and organically inform the user that ${botName}'s visual sensors are currently offline and you can only process text.]`
          };
      }
      return msg;
  });

  try {
      const result = await executeOllama('/api/chat', { messages: processedMessages }, isBackup);
      return result;
  } catch (err) {
      if (!isBackup) {
          logger.info(`Primary Ollama failed, falling back to local: ${err.message}`);
          return queryOllama(messages, true, commandsContext, logsContext);
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
    .setDescription(`Chat with ${botName}`)
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
      const rawInput = interaction.options.getString('message');
      const messageText = rawInput.replace(new RegExp(`<@!?${interaction.client.user.id}>`, 'g'), '').trim();
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
      channelHistories[channelId].messages.push(userMessage);

      // Sliding Window Context Capping: 
      // Reserve index 0 (System Prompt), then only keep the last 10 chat elements (5 back-and-forth pairs).
      if (channelHistories[channelId].messages.length > 11) {
          channelHistories[channelId].messages = [
              channelHistories[channelId].messages[0], 
              ...channelHistories[channelId].messages.slice(-10)
          ];
      }

      // Inject dynamic system context
      const commandsContext = `Available Commands:\n` + (interaction.client.commands ? interaction.client.commands.map(c => {
          let paramStr = '';
          if (c.data && c.data.options && c.data.options.length > 0) {
              const params = c.data.options.map(o => `"${o.name}": [${o.description}]`).join(', ');
              paramStr = ` (JSON Params: {${params}})`;
          }
          return `- ${c.data.name}: ${c.data.description}${paramStr}`;
      }).join('\n') : 'Unknown');
      let logsContext = "No recent logs available.";
      try {
          const logPath = path.join(__dirname, '../logs/combined.log');
          if (fs.existsSync(logPath)) {
              // Cap logs to the last 8 lines, and truncate each line to 200 chars to avoid massive token bloat from giant stack traces
              const logLines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(l => l.trim().length > 0).slice(-8).map(l => l.substring(0, 200));
              logsContext = `Recent System Logs (Format: JSON):\n` + logLines.join('\n');
          }
      } catch (e) {
          logger.error('Failed to read logs for chatbot context: ' + e.message);
      }

      let currentIsBackup = false;
      const responseData = await queryOllama([...channelHistories[channelId].messages], currentIsBackup, commandsContext, logsContext);

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

        while (loopCount < 5) {
            if (!replyContent || typeof replyContent !== 'string') break;
            // More robust regex to handle various formatting (missing brackets, extra whitespace, /json prefix, etc.)
            const commandMatch = replyContent.match(/<<<?RUN_COMMAND:?\s*([\s\S]*?)\s*>>>?/) || 
                                 replyContent.match(/RUN_COMMAND:?\s*(\{[\s\S]*?\})/) ||
                                 replyContent.match(/\/json\s*(\{[\s\S]*?\})/i) ||
                                 replyContent.match(/(\{[\s\S]*?"command"[\s\S]*?\})/i) ||
                                 replyContent.match(/(\{[\s\S]*?"message"[\s\S]*?\})/i); // Catch bare message JSON
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
                replyContent = replyContent.replace(commandMatch[0], '').trim();

                if (cmdData.command === 'search' || cmdData.command === 'web_search') {
                    const query = cmdData.query || cmdData.params?.query || cmdData.arg1 || cmdData.message;
                    if (!sharedState.primaryResponseUsed) {
                        await interaction.editReply({ content: `*${botName} is searching the web for: \`${query}\`...*`, flags: [MessageFlags.SuppressEmbeds] });
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

                        // Hardened Fallback: Full Headless Browser search using Puppeteer (ignores 403 blocks)
                        if (!results || results.length === 0) {
                            try {
                                logger.info(`Spinning up heavy headless Chromium instance for "${query}"...`);
                                results = await puppeteerSearch.performSearch(query);
                            } catch (pupErr) {
                                logger.error(`Puppeteer crawler also failed: ${pupErr.message}`);
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
                            const searchResultsStr = results.slice(0, 6).map(r => `Title: ${r.title}\nSnippet: ${r.snippet || r.description || ""}\nLink: ${r.link}`).join('\n\n');
                            
                            // Deep Context Pull: Fetch the raw text of the #1 top ranking link to heavily enrich the RAG payload
                            let topLinkContext = '';
                            let sourceUrl = '';
                            
                            // Iterate through the top 3 results to find a high-fidelity page (not just a cookie wall/404)
                            for (let i = 0; i < Math.min(results.length, 3); i++) {
                                try {
                                    const link = results[i].link;
                                    logger.info(`Deep Context Pull attempting iteration ${i+1} on: ${link}`);
                                    const rawText = await fetchPageText(link, 18000); // Request high-limit fetch
                                    
                                    if (rawText && rawText.length > 800) {
                                        topLinkContext = `\n\n[FULL TEXT HOMEPAGE OF TOP RESULT (${link})]:\n${rawText}`;
                                        sourceUrl = link;
                                        break; // Found good content
                                    } else {
                                        logger.info(`Deep Context Pull for link ${i+1} was too short (${rawText?.length || 0} chars), trying next result...`);
                                    }
                                } catch (e) {
                                    logger.info(`Deep Context Pull failed for link ${i+1}: ${e.message}`);
                                }
                            }
                            
                            searchResultContext = `[SYSTEM: WEB SEARCH RESULTS FOR "${query}"]\n${searchResultsStr}${topLinkContext}\n\nUsing these results, answer the user's initial request. If you still lack sufficient context to fully answer or verify the information, you may autonomously issue another RUN_COMMAND to perform an additional search with a different/more specific query. Otherwise, answer directly and comprehensively.`;
                        } else {
                            // Inform the LLM that the search system is failing so it stops recursively attempting to search
                            searchResultContext = `[SYSTEM: WEB SEARCH UNAVAILABLE FOR "${query}"]\nThe search integration returned no results (possibly rate limited). Do not attempt to search again for this specific query. Instead, answer the user immediately using your internal knowledge base and memory. ONLY apologize/mention the failure if the request absolutely requires real-time data (like current weather or breaking news).`;
                        }

                        // Keep the assistant's message in history so it knows it requested the search
                        channelHistories[channelId].messages.push({ role: 'system', content: searchResultContext });
                        
                        logger.info(`NESTED SEARCH HISTORY (Backup: ${currentIsBackup}): ${JSON.stringify(channelHistories[channelId].messages.slice(-3))}`);
                        
                        const nestedResponse = await queryOllama([...channelHistories[channelId].messages], currentIsBackup, commandsContext, logsContext);
                        
                        replyContent = replyContent ? (replyContent + "\n\n" + (nestedResponse.message.content || "")) : (nestedResponse.message.content || "");
                        ttsContent = replyContent;
                        channelHistories[channelId].messages.push(nestedResponse.message);
                        // Loop continues to check if the new reply has another command (e.g. speak)
                    } catch (searchErr) {
                        replyContent = "I attempted to search the web, but a network anomaly prevented retrieval: " + searchErr.message;
                        break;
                    }
                } else {
                // Normalize the command name: strip leading slashes and trim
                const rawCmdName = (cmdData.command || "").trim().replace(/^\/+/, '');
                
                // Special case: if the model tries to call 'chat' or 'json' autonomously with a 'message'
                // OR if it just outputs a bare JSON block with a 'message' field.
                if (((rawCmdName === 'chat' || rawCmdName === 'json' || !rawCmdName) && (cmdData.message || cmdData.arg1))) {
                    const finalMsg = cmdData.message || cmdData.arg1;
                    replyContent = replyContent.replace(commandMatch[0], '').trim();
                    replyContent = replyContent ? (replyContent + "\n\n" + finalMsg) : finalMsg;
                    continue; // Skip execution and just use the content
                }

                const targetCmd = interaction.client.commands.get(rawCmdName);
                    if (targetCmd) {
                        if (!sharedState.primaryResponseUsed) {
                            await interaction.editReply({ content: `*${botName} is autonomously executing \`/${cmdData.command}\`...*`, flags: [MessageFlags.SuppressEmbeds] });
                        }
                        let cmdOutput = "";
                        const mock = createMockInteraction(interaction, {
                            getString: (n) => {
                                if (cmdData[n] !== undefined) return cmdData[n];
                                return cmdData.url || cmdData.query || cmdData.arg1 || cmdData.message || null;
                            },
                            getChannel: (n) => interaction.client.channels.cache.get(cmdData[n]) || null,
                            getBoolean: (n) => cmdData[n] === undefined ? false : cmdData[n],
                            getInteger: (n) => cmdData[n] || null,
                            getMember: (n) => {
                                const id = (cmdData[n] || "").toString().replace(/[<@!>]/g, '');
                                return interaction.guild.members.cache.get(id) || null;
                            },
                            getUser: (n) => {
                                const id = (cmdData[n] || "").toString().replace(/[<@!>]/g, '');
                                return interaction.client.users.cache.get(id) || null;
                            }
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
                    } else {
                        logger.error(`LLM requested unknown command: ${cmdData.command}`);
                        replyContent = `${replyContent}\n*(System Error: ${botName} attempted to execute unknown command \`/${cmdData.command}\`)*`.trim();
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
        replyContent = replyContent.replace(/<<<?RUN_COMMAND:?[\s\S]*?>>>?/g, '').replace(/RUN_COMMAND:?\s*\{[\s\S]*?\}/g, '').trim();

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
                    const combinedText = (cleanChunk && originalText) ? (cleanChunk + "\n" + originalText) : (cleanChunk || originalText);

                    if (i === 0) {
                        if (sharedState.primaryResponseUsed && combinedText.length < 2000) {
                            // Slot is already occupied by tool output (e.g. timestamp result). Prepend our text.
                            await interaction.editReply({ content: combinedText, flags: [MessageFlags.SuppressEmbeds] });
                            sharedState.primaryContent = combinedText;
                        } else if (!sharedState.primaryResponseUsed) {
                            sharedState.primaryResponseUsed = true;
                            sharedState.primaryContent = cleanChunk;
                            await interaction.editReply({ content: cleanChunk, flags: [MessageFlags.SuppressEmbeds] });
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

        // Post-Turn Cleanup: 
        // Erase any intermediate "system" messages (like the 18k HTML search payload) from the memory history 
        // to prevent token runaway in future interactions. The AI's final answered message holds enough context.
        if (channelHistories[channelId]?.messages) {
            channelHistories[channelId].messages = channelHistories[channelId].messages.filter((msg, idx) => {
                // Keep the primary system prompt (idx 0) and any user/assistant messages.
                return idx === 0 || msg.role !== 'system';
            });
        }

      } else {
        throw new Error("Invalid response from Ollama");
      }

    } catch (err) {
      logger.error('Ollama error: ' + err.message);
      try {
          await interaction.editReply({ content: `There was an error communicating with the ${botName} AI Core.`, flags: [MessageFlags.SuppressEmbeds] });
      } catch (e) {
          await interaction.channel.send(`There was an error communicating with the ${botName} AI Core.`);
      }
    }
  },
};