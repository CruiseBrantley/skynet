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
const { queryLocalOrRemote } = require('../util/ollama');
const { jsonrepair } = require('jsonrepair');
const logger = require('../logger');
const agentMemory = require('../util/AgentMemory');
const ActionExecutor = require('../util/ActionExecutor');

const COMMAND_REGEX = /<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd]:\s*(\{[\s\S]*?\})\s*>>>/;
const SCRUB_REGEX = /<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd]:[\s\S]*?>>>/gi;

function scrubTags(text) {
    if (!text) return text;
    return text.replace(SCRUB_REGEX, '').trim();
}

// Load system prompt from config file, falling back to a generic default
let SYSTEM_PROMPT;
try {
    SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '../config/system_prompt.txt'), 'utf8').trim();
} catch (e) {
    SYSTEM_PROMPT = "You are Skynet.";
}

const channelHistories = {};
const MAX_CHANNEL_HISTORIES = 50;

// Helper to build a mock interaction for autonomous command execution
function createMockInteraction(interaction, optionsOverrides = {}, onOutput = null, sharedState = { primaryResponseUsed: false, primaryContent: "" }) {
    const capture = async (msg) => {
        const isString = typeof msg === 'string';
        const str = isString ? msg : (msg?.content || "");
        const hasEmbeds = !isString && msg?.embeds && msg.embeds.length > 0;
        
        if (str || hasEmbeds) {
            if (onOutput && str) onOutput(str);
            
            // For merging purposes, we track if there's text
            const currentContent = typeof sharedState.primaryContent === 'string' ? sharedState.primaryContent : (sharedState.primaryContent?.content || "");
            const combinedText = currentContent ? (currentContent + "\n" + str) : str;

            if (!sharedState.primaryResponseUsed) {
                sharedState.primaryResponseUsed = true;
                sharedState.primaryContent = msg; // Store the full object (embeds and all)
                await interaction.editReply(msg);
            } else if (!hasEmbeds && combinedText.length < 2000) {
                // If it's just text and it fits, merge with existing text if there are NO EMBEDS
                const currentIsEmbed = sharedState.primaryContent?.embeds?.length > 0;
                if (!currentIsEmbed) {
                    sharedState.primaryContent = combinedText;
                    await interaction.editReply({ content: combinedText, flags: [MessageFlags.SuppressEmbeds] });
                } else {
                    await interaction.followUp({ content: str, flags: [MessageFlags.SuppressEmbeds] });
                }
            } else {
                await interaction.followUp(msg);
            }
        }
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
            getSubcommand: () => null, getSubcommandGroup: () => null,
            ...optionsOverrides
        },
        reply: capture,
        deferReply: async () => {},
        editReply: capture,
        followUp: capture,
        deleteReply: async () => { 
            sharedState.primaryResponseUsed = false; 
            sharedState.primaryContent = ""; 
            return interaction.deleteReply().catch(() => {});
        },
        toString() { 
            const ch = (this.channel || interaction.channel);
            if (ch && typeof ch.toString === 'function') {
                const s = ch.toString();
                if (s && s !== '[object Object]') return s;
                if (ch.name) return `#${ch.name}`;
            }
            return "[Unknown Channel]";
        },
    };
}

const { queryOllamaWithContext } = require('../util/ollama');


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
  execute: execute,
  scrubTags,
  COMMAND_REGEX,
  SCRUB_REGEX
};

async function execute(interaction, database) {
    const sharedState = {
        primaryResponseUsed: false,
        primaryContent: null
    };

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
      
      const userHandle = `@${interaction.user.username}${interaction.member?.nickname ? ` (${interaction.member.nickname})` : ''}`;
      const userMessage = { role: 'user', content: `${userHandle}: ${messageText}` };
      if (base64Image) {
          userMessage.images = [base64Image];
      }
      channelHistories[channelId].messages.push(userMessage);

      // Sliding Window Context Capping: 
      // Reserve index 0 (System Prompt), then only keep the last 20 chat elements (10 back-and-forth pairs).
      if (channelHistories[channelId].messages.length > 21) {
          channelHistories[channelId].messages = [
              channelHistories[channelId].messages[0], 
              ...channelHistories[channelId].messages.slice(-20)
          ];
      }

      // Inject dynamic system context
      const commandsContext = `Available Commands & Actions:\n` + (interaction.client.commands ? interaction.client.commands.map(c => {
          let paramStr = '';
          if (c.data && c.data.options && c.data.options.length > 0) {
              const params = c.data.options.map(o => {
                  if (o.type === 1 || o.type === 2) {
                      // Subcommand or Subcommand Group
                      return `subcommand: "${o.name}" [${o.description}]`;
                  }
                  return `"${o.name}": [${o.description}]`;
              }).join(', ');
              paramStr = ` (JSON Params: {${params}})`;
          }
          return `- ${c.data.name}: ${c.data.description}${paramStr}`;
      }).join('\n') : 'Unknown') + '\n' + ActionExecutor.listActions().map(a => `- ${a.name}: ${a.description} (JSON Params: ${JSON.stringify(a.schema)})`).join('\n');
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

      // ---------------------------------------------
      // 🧊 Context Enrichment: Real-time Channel State
      // Fetch recent messages to see IDs and Reactions so actions like add_reaction or send_thread can target them
      let channelContext = "Recent Channel Context:\n(No recent history available)";
      try {
          const recentMessages = await interaction.channel.messages.fetch({ limit: 40 });
          channelContext = `Recent Channel Context:\n` + recentMessages.map(m => {
              const reactions = m.reactions.cache.map(r => `${r.emoji.name} (x${r.count})`).join(', ');
              let authorHandle = `@${m.author.username}${m.member?.nickname ? ` (${m.member.nickname})` : ''}`;
              
              // Resolve mentions in the text for the AI's convenience
              let enrichedContent = m.content;
              const mentions = m.content.match(/<@!?(\d+)>/g);
              if (mentions) {
                  for (const mention of mentions) {
                      const id = mention.replace(/[<@!>]/g, '');
                      const user = interaction.client.users.cache.get(id);
                      if (user) enrichedContent = enrichedContent.replaceAll(mention, `@${user.username}`);
                  }
              }

              return `ID: ${m.id} | Author: ${authorHandle} | Text: "${enrichedContent.substring(0, 100)}${enrichedContent.length > 100 ? '...' : ''}" ${reactions ? `| Reactions: [${reactions}]` : ''}`;
          }).reverse().join('\n');
          logger.info(`Context Enrichment: Fetched ${recentMessages.size} messages for context.`);
      } catch (e) {
          logger.warn(`Context Enrichment: Failed to fetch channel context: ${e.message}`);
      }

      // We append this as a TEMPORARY system message for this specific prompt, but ensure it goes BEFORE the user's latest message
      const historyWithoutLast = channelHistories[channelId].messages.slice(0, -1);
      const lastUserMessage = channelHistories[channelId].messages[channelHistories[channelId].messages.length - 1];

      const finalPromptMessages = [
          ...historyWithoutLast,
          { role: 'system', content: channelContext },
          lastUserMessage
      ];

      logger.info(`Chat Context: Sending prompt with ${finalPromptMessages.length} messages. Commands: ${ActionExecutor.listActions().length} available.`);
      const responseData = await queryOllamaWithContext(finalPromptMessages, {
          isBackup: currentIsBackup,
          commandsContext,
          logsContext,
          guildId: interaction.guildId,
          systemPrompt: SYSTEM_PROMPT
      }, botName);
      if (responseData && responseData.message) {
        const rawAIContent = responseData.message.content || "";
        logger.info(`AI Raw Response: "${rawAIContent.substring(0, 300)}${rawAIContent.length > 300 ? '...' : ''}"`);
        channelHistories[channelId].messages.push(responseData.message); // store assistant reply

        // Discord message max length is 2000. Chunk intelligently.
        let replyContent = responseData.message.content || "";
        
        const executedCommands = new Set();
        let loopCount = 0;
        while (loopCount < 5) {
            if (!replyContent || typeof replyContent !== 'string') break;
            
            let commandMatch = replyContent.match(COMMAND_REGEX);
            let jsonStr = "";
            let fullMatchString = "";

            if (commandMatch) {
                fullMatchString = commandMatch[0];
                jsonStr = commandMatch[1];
            } else {
                // Fallback: If no tags, did the AI just output a naked JSON block?
                const nakedMatch = replyContent.match(/(\{[\s\S]*?\})/);
                if (nakedMatch) {
                    try {
                        const candidate = nakedMatch[1];
                        const testData = JSON.parse(jsonrepair(candidate));
                        if (testData.command) {
                            jsonStr = candidate;
                            fullMatchString = nakedMatch[0];
                            logger.info(`AUTONOMOUS: Detected naked JSON: ${jsonStr.substring(0, 100)}`);
                        }
                    } catch (e) {}
                }
            }

            if (!jsonStr) break;
            
            loopCount++;
            try {
                const cmdData = JSON.parse(jsonrepair(jsonStr));
                
                // Remove the command tag (or naked JSON) from the visible reply AND the persistent history
                replyContent = replyContent.replace(fullMatchString, '').trim();
                const lastMsg = channelHistories[channelId].messages[channelHistories[channelId].messages.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                    lastMsg.content = lastMsg.content.replace(fullMatchString, '[Command Executed]').trim();
                }

                const rawCmdName = (cmdData.command || "").trim().replace(/^\/+/, '');
                // Identify the parameters. If they are nested in 'params', use that. 
                // Otherwise, use all keys EXCEPT 'command' as the parameters.
                let params = cmdData.params;
                if (!params || typeof params !== 'object') {
                    const { command, ...rest } = cmdData;
                    params = rest;
                }
                
                executedCommands.add(rawCmdName);
                
                // Special case: natural language "memories" handled locally
                if (['remember', 'recall', 'forget'].includes(rawCmdName)) {
                    if (rawCmdName === 'remember') {
                        const key = cmdData.key || cmdData.params?.key;
                        const value = cmdData.value || cmdData.params?.value;
                        const ttl = parseInt(cmdData.ttl_days ?? cmdData.params?.ttl_days ?? 30);
                        if (key && value !== undefined) {
                            agentMemory.set(key, value, ttl, interaction.guildId);
                            channelHistories[channelId].messages.push({ role: 'system', content: `[SYSTEM: Stored memory "${key}"]. Acknowledge naturally.]` });
                        }
                    } else if (rawCmdName === 'recall') {
                        const key = cmdData.key || cmdData.params?.key;
                        const val = key ? agentMemory.get(key, interaction.guildId) : null;
                        channelHistories[channelId].messages.push({ role: 'system', content: val ? `[SYSTEM: Memory found: "${val}"]` : `[SYSTEM: No memory found for "${key}"]` });
                    }
                    
                    channelHistories[channelId].messages.push({ role: 'system', content: `[SYSTEM: Operations complete. The user has been notified. Provide a 1-sentence final acknowledgement, then stop.]` });
                    const followup = await queryOllamaWithContext([...channelHistories[channelId].messages], {
                        isBackup: currentIsBackup,
                        commandsContext,
                        logsContext,
                        guildId: interaction.guildId,
                        systemPrompt: SYSTEM_PROMPT
                    }, botName);
                    replyContent = (replyContent + "\n" + (followup.message.content || '')).trim();
                    channelHistories[channelId].messages.push(followup.message);
                    continue;
                }

                // Check for generic actions or slash commands
                const allActions = ActionExecutor.listActions();
                const isAction = allActions.some(a => a.name === rawCmdName);
                const targetCmd = interaction.client.commands.get(rawCmdName);

                if (isAction || targetCmd) {
                    if (!sharedState.primaryResponseUsed) {
                        await interaction.editReply({ content: `*${botName} is autonomously executing \`${rawCmdName}\`...*`, flags: [MessageFlags.SuppressEmbeds] });
                    }

                    let actionResult = "";
                    const targetChannel = interaction.channel;
                    const mock = createMockInteraction(interaction, {
                        params: params || {},
                        channel: targetChannel
                    }, null, sharedState);

                    if (isAction) {
                        const actionContext = { 
                            interaction: mock, // Use the MOCK to capture state
                            channel: targetChannel, 
                            client: interaction.client,
                            guild: interaction.guild,
                            userId: interaction.user.id, 
                            guildId: interaction.guildId, 
                            channelId: targetChannel.id, 
                            member: interaction.member, 
                            user: interaction.user 
                        };
                        const result = await ActionExecutor.executeAction(rawCmdName, params, actionContext);
                        if (result.success) sharedState.primaryResponseUsed = true;
                        const outputStr = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
                        actionResult = result.success ? (outputStr || "[SYSTEM: Action executed successfully.]") : `[SYSTEM: Action failed: ${result.error}]`;
                    } else {
                        const { getParam } = require('../util/commandHelper');
                        mock.options = {
                            getString: (n) => String(params[n] ?? getParam(cmdData, n) ?? ""),
                            getSubcommand: () => params.subcommand || getParam(cmdData, 'subcommand'),
                            getChannel: (n) => interaction.client.channels.cache.get((params[n] || getParam(cmdData, n) || "").toString().replace(/[<#>]/g, '')) || null,
                            getBoolean: (n) => {
                                const val = params[n] ?? getParam(cmdData, n);
                                return val === true || val === 'true' || val === 1 || val === '1';
                            },
                            getInteger: (n) => parseInt(params[n] ?? getParam(cmdData, n) ?? 0),
                            getUser: (n) => interaction.client.users.cache.get((params[n] || getParam(cmdData, n) || "").toString().replace(/[<@!>]/g, '')) || null,
                            getAttachment: () => null,
                            getMember: () => null
                        };

                        try {
                            sharedState.primaryResponseUsed = true;
                            const output = await targetCmd.execute(mock, database);
                            actionResult = typeof output === 'string' ? output : `[SYSTEM: Command /${rawCmdName} completed.]`;
                        } catch (err) {
                            actionResult = `[SYSTEM: Error executing /${rawCmdName}: ${err.message}]`;
                        }
                    }

                    channelHistories[channelId].messages.push({ role: 'system', content: `[SYSTEM: Action Result: ${actionResult}. The result is visible to the user. Do NOT repeat the command. Provide a 1-sentence acknowledgement, then stop.]` });
                    const followup = await queryOllamaWithContext([...channelHistories[channelId].messages], {
                        isBackup: currentIsBackup,
                        commandsContext,
                        logsContext,
                        guildId: interaction.guildId,
                        systemPrompt: SYSTEM_PROMPT
                    }, botName);
                    replyContent = (replyContent + "\n" + (followup.message.content || '')).trim();
                    channelHistories[channelId].messages.push(followup.message);
                    continue;
                }
            } catch (err) {
                logger.error(`Loop error: ${err.stack}`);
                break;
            }
        }

        if (replyContent.length === 0) {
            // AI didn't provide a final summary string.
            if (sharedState.primaryResponseUsed) {
                // Determine if we need to preserve existing embeds
                let originalEmbeds = [];
                if (sharedState.primaryContent && typeof sharedState.primaryContent !== 'string') {
                    originalEmbeds = sharedState.primaryContent.embeds || [];
                }

                if (originalEmbeds.length > 0) {
                    // We have an embed! Just clear the status text and keep the visual.
                    await interaction.editReply({ 
                        content: "", 
                        embeds: originalEmbeds 
                    }).catch(() => {});
                } else {
                    // No visuals? Use the standard completion checkmark.
                    await interaction.editReply({ 
                        content: "✅ **Task complete.**", 
                        flags: [MessageFlags.SuppressEmbeds] 
                    }).catch(() => {});
                }
            } else {
                await interaction.deleteReply().catch(() => {});
            }
        } else {
            const chunks = splitMessage(replyContent);
            for (let i = 0; i < chunks.length; i++) {
                try {
                    const cleanChunk = chunks[i].replace(/<<<RUN_COMMAND:[\s\S]*?>>>/g, '').trim();
                    if (!cleanChunk && i === 0 && !sharedState.primaryResponseUsed) continue; 

                    if (i === 0) {
                        // Extract any existing content or embeds
                        let originalText = "";
                        let originalEmbeds = [];
                        
                        if (sharedState.primaryContent) {
                            if (typeof sharedState.primaryContent === 'string') {
                                originalText = sharedState.primaryContent;
                            } else {
                                originalText = sharedState.primaryContent.content || "";
                                originalEmbeds = sharedState.primaryContent.embeds || [];
                            }
                        }

                        // Clean status messages from the original text
                        const cleanOriginal = originalText.replace(/\*.*is autonomously executing.*\*/g, '').trim();

                        if (sharedState.primaryResponseUsed && originalEmbeds.length > 0) {
                            // If we already have embeds, we MERGE the text into the primary reply 
                            // as long as it fits, preserving the visuals.
                            const combinedText = (cleanChunk && cleanOriginal) ? (cleanChunk + "\n" + cleanOriginal) : (cleanChunk || cleanOriginal);
                            
                            // If the merged text is too long (>2000), THEN we followUp.
                            if (combinedText.length > 2000) {
                                await interaction.followUp({ content: cleanChunk, flags: [MessageFlags.SuppressEmbeds] });
                            } else {
                                await interaction.editReply({ 
                                    content: combinedText || "✅ **Task complete.**", 
                                    embeds: originalEmbeds 
                                });
                            }
                        } else {
                            // No embeds? We merge the text or overwrite the status message.
                            const combinedText = (cleanChunk && cleanOriginal) ? (cleanChunk + "\n" + cleanOriginal) : (cleanChunk || cleanOriginal);
                            sharedState.primaryResponseUsed = true;
                            sharedState.primaryContent = combinedText;
                            await interaction.editReply({ 
                                content: combinedText || "✅ **Task complete.**", 
                                flags: [MessageFlags.SuppressEmbeds] 
                            });
                        }
                    } else {
                        await interaction.followUp({ content: chunks[i], flags: [MessageFlags.SuppressEmbeds] });
                    }
                } catch (discordErr) {
                    const fallbackClean = chunks[i].replace(/<<<RUN_COMMAND:[\s\S]*?>>>/g, '').trim();
                    if (fallbackClean) {
                        logger.info('Interaction reply failed, falling back to channel.send: ' + discordErr.message);
                        await interaction.channel.send({ content: fallbackClean, flags: [MessageFlags.SuppressEmbeds] });
                    }
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
  }