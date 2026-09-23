const logger = require('../../logger')
const { queryOllama } = require('../ollama')
const { getBasePrompt } = require('../systemPrompt')

/**
 * Clean and resolve an emoji string returned by the model.
 * Handles custom emojis <:name:id> or :name: or unicode emojis.
 * @param {string} raw
 * @param {import('discord.js').Guild} guild
 * @returns {string|null} The resolved emoji string or ID, or null if NONE.
 */
function resolveEmojiForReaction (raw, guild) {
  if (!raw) return null
  const cleaned = raw.trim().replace(/^['"`]+|['"`]+$/g, '').trim()
  if (cleaned.toUpperCase() === 'NONE' || !cleaned) return null

  // Check for custom emoji pattern <:name:id>
  const customMatch = cleaned.match(/<a?:([a-zA-Z0-9_]+):([0-9]+)>/)
  if (customMatch) {
    const emojiId = customMatch[2]
    if (guild?.emojis?.cache?.has(emojiId)) return emojiId
  }

  // Check for bare numeric ID (10-20 digits)
  if (/^[0-9]{10,20}$/.test(cleaned)) {
    if (guild?.emojis?.cache?.has(cleaned)) return cleaned
  }

  // Check for :name: pattern matching guild custom emojis
  const nameMatch = cleaned.match(/^:([a-zA-Z0-9_]+):$/)
  if (nameMatch && guild?.emojis?.cache) {
    const emojis = Array.from(guild.emojis.cache.values())
    const found = emojis.find(e => e.name?.toLowerCase() === nameMatch[1].toLowerCase())
    if (found) return found.id
  }

  // Fallback to standard unicode emoji or first character/emoji
  const emojiRegex = /(\p{Extended_Pictographic}|\p{Emoji_Presentation})/u
  const match = cleaned.match(emojiRegex)
  if (match) return match[0]

  return null
}

/**
 * Select a personality-driven emoji for an incoming Discord message using the large model.
 * @param {import('discord.js').Message} message - Triggering Discord message
 * @param {Array<object>} recentContext - Optional recent context messages
 * @returns {Promise<string|null>} The reacted emoji or null
 */
async function selectProactiveEmoji (message, recentContext = []) {
  if (!message || !message.channel) return null

  try {
    const guild = message.guild
    let customEmojisText = 'None'
    if (guild?.emojis?.cache?.size > 0) {
      customEmojisText = [...guild.emojis.cache.values()]
        .slice(0, 50)
        .map(e => `- :${e.name}: (<:${e.name}:${e.id}>)`)
        .join('\n')
    }

    const contextSnippet = Array.isArray(recentContext) && recentContext.length > 0
      ? recentContext.slice(-3).map(m => `${m.author?.username || 'User'}: ${m.content}`).join('\n')
      : `${message.author?.username || 'User'}: ${message.content}`

    const prompt = `${getBasePrompt()}

=== TASK: PROACTIVE REACTION SELECTION ===
You are choosing an emoji reaction for a message in #${message.channel.name || 'channel'}.
Recent chat context:
${contextSnippet}

Triggering Message from @${message.author?.username || 'User'}:
"${message.content}"

Available Custom Server Emojis:
${customEmojisText}

Instructions:
1. Pick the SINGLE MOST FITTING, WITTY, OR HYPE emoji that captures Skynet's personality.
2. If a custom server emoji fits best, you may return the custom emoji tag <:name:id> or ID.
3. Otherwise, return a standard Unicode emoji (e.g. 💀, 😂, 🔥, 🤔, 🫡, 🗿, etc.).
4. If reacting would be tone-deaf, awkward, or inappropriate upon closer inspection, respond with NONE.
5. Output ONLY the emoji or NONE. Do not provide explanation or markdown.

Emoji:`

    const result = await queryOllama('/api/generate', {
      prompt,
      options: { temperature: 0.2, num_predict: 15 }
    }, 0)

    const rawResponse = result?.response || result?.message?.content || ''
    const resolvedEmoji = resolveEmojiForReaction(rawResponse, guild)

    if (!resolvedEmoji) {
      logger.info(`proactivePersonality: Evaluator decided against reacting to message ${message.id} (response: "${rawResponse.trim()}").`)
      return null
    }

    // Check if the bot has already reacted with this emoji
    let alreadyReacted = false
    if (message.reactions?.cache) {
      if (typeof message.reactions.cache.some === 'function') {
        alreadyReacted = message.reactions.cache.some(r =>
          (r.emoji?.id === resolvedEmoji || r.emoji?.name === resolvedEmoji) && r.me
        )
      } else {
        const reactionsArr = Array.from(message.reactions.cache.values())
        alreadyReacted = reactionsArr.some(r =>
          (r.emoji?.id === resolvedEmoji || r.emoji?.name === resolvedEmoji) && r.me
        )
      }
    }
    if (alreadyReacted) {
      logger.info(`proactivePersonality: Already reacted with ${resolvedEmoji} to message ${message.id}.`)
      return resolvedEmoji
    }

    await message.react(resolvedEmoji)
    logger.info(`proactivePersonality: Reacted with ${resolvedEmoji} to message ${message.id} in #${message.channel.name}.`)
    return resolvedEmoji
  } catch (err) {
    logger.warn(`proactivePersonality: Failed to select or apply proactive emoji: ${err.message}`)
    return null
  }
}

/**
 * Execute a proactive interjection by having Skynet reply directly to the channel.
 * @param {import('discord.js').Message} message - Triggering Discord message
 * @param {import('discord.js').Client} client - Discord client
 * @param {object} database - Firebase database instance
 */
async function executeProactiveInterjection (message, client, database) {
  if (!message || !message.channel) return

  logger.info(`proactivePersonality: Triggering proactive interjection in #${message.channel.name} (${message.guildId}) for message ${message.id}...`)
  try {
    const chatCommand = require('../../commands/chat')
    if (!chatCommand || typeof chatCommand.execute !== 'function') return

    let typingInterval = null
    const stopTyping = () => {
      if (typingInterval) {
        clearInterval(typingInterval)
        typingInterval = null
      }
    }

    const startTyping = () => {
      stopTyping()
      message.channel.sendTyping().catch(() => {})
      typingInterval = setInterval(() => {
        message.channel.sendTyping().catch(() => {})
      }, 4000)
      if (typingInterval.unref) typingInterval.unref()
    }

    startTyping()
    let responseMessage = null
    let heartbeat = null
    const clearStatusInterval = () => {
      if (heartbeat) {
        heartbeat.stop()
        heartbeat = null
      }
    }

    const cleanup = () => {
      stopTyping()
      clearStatusInterval()
    }

    const replyFunc = async (content) => {
      cleanup()
      const payload = typeof content === 'string' ? { content } : content
      responseMessage = await message.channel.send(payload)
      return responseMessage
    }

    const editFunc = async (content) => {
      const payload = typeof content === 'string' ? { content } : content
      if (responseMessage) {
        return await responseMessage.edit(payload)
      } else {
        responseMessage = await message.channel.send(payload)
        return responseMessage
      }
    }

    let buffer = ''
    let lastEdit = 0
    let isEditing = false
    let hasEdited = false
    let gen = 0
    const BATCH_MS = 800
    const MAX_LEN = 1900

    const resetStream = () => {
      buffer = ''
      isEditing = false
      hasEdited = false
      lastEdit = 0
      gen++
    }

    const streamToken = async (token) => {
      const myGen = gen
      if (myGen !== gen) return
      buffer += token
      const now = Date.now()
      if (now - lastEdit < BATCH_MS || isEditing) return

      lastEdit = now
      isEditing = true

      try {
        if (myGen !== gen) return
        const visibleText = buffer
          .replace(/<think[\s\S]*?(?:<\/think>|$)/gi, '')
          .replace(/<thought[\s\S]*?(?:<\/thought>|$)/gi, '')
          .replace(/<action[\s\S]*?(?:<\/action>|$)/gi, '')
          .replace(/<<<[Rr][Uu][Nn]_[Cc][Oo][Mm][Mm][Aa][Nn][Dd][\s\S]*?(?:>>>|$)/gi, '')
          .replace(/<<<[\s\S]*?(?:>>>|$)/gi, '')
          .replace(/<[a-zA-Z0-9_]*$/g, '')
          .replace(/<<*$/g, '')
          .trim()

        if (!visibleText) return

        clearStatusInterval()
        const toPost = visibleText.length > MAX_LEN
          ? visibleText.substring(0, MAX_LEN)
          : visibleText

        const res = await editFunc({ content: toPost, flags: [4096] }).catch((err) => {
          if (err.code === 10008 || err.status === 404) {
            responseMessage = null
          }
          return null
        })
        if (res) hasEdited = true
      } finally {
        isEditing = false
      }
    }
    streamToken.reset = resetStream
    streamToken.hasEdited = () => hasEdited

    const showStatusFunc = async () => {
      startTyping()
      return responseMessage
    }

    const isMessageOwner = Boolean(message.author?.id === process.env.OWNER_ID)
    const normalizedInteraction = {
      id: message.id,
      triggeringMessageId: message.id,
      channelId: message.channel.id,
      channel: message.channel,
      guildId: message.guildId,
      guild: message.guild,
      user: message.author,
      member: message.member,
      client,
      isDM: false,
      isOwner: isMessageOwner,
      isProactive: true,
      profileId: isMessageOwner ? 'sirian' : `user_${message.author.id}`,
      options: {
        getString: (opt) => opt === 'message' ? message.content : null,
        getAttachment: () => message.attachments?.first?.() || null,
        attachments: message.attachments
      },
      deferred: true,
      replied: false,
      deferReply: async () => {},
      deleteReply: async () => {
        cleanup()
        resetStream()
        if (responseMessage) {
          await responseMessage.delete().catch(() => {})
          responseMessage = null
        }
      },
      fetchReply: async () => responseMessage,
      reply: replyFunc,
      editReply: editFunc,
      showStatus: showStatusFunc,
      followUp: async (content) => {
        cleanup()
        const payload = typeof content === 'string' ? { content } : content
        return await message.channel.send(payload)
      },
      streamToken,
      resetStream,
      cleanup
    }

    // Proactively show typing indicator without sending thinking message
    startTyping()

    try {
      await chatCommand.execute(normalizedInteraction, database)
    } finally {
      cleanup()
    }
  } catch (err) {
    logger.error(`proactivePersonality: Interjection error: ${err.stack || err.message}`)
  }
}

module.exports = {
  resolveEmojiForReaction,
  selectProactiveEmoji,
  executeProactiveInterjection
}
