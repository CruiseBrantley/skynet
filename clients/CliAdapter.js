const readline = require('readline')
const IClientAdapter = require('../interfaces/IClientAdapter')
const NormalizedInteraction = require('../interfaces/NormalizedInteraction')
const conversationStore = require('../core/conversationStore')
const { getBasePrompt } = require('../util/systemPrompt')
const logger = require('../logger')

class CliAdapter extends IClientAdapter {
  constructor ({ sessionName = 'terminal', profileId = null } = {}) {
    super({
      id: 'cli',
      name: 'Terminal CLI Client',
      capabilities: ['text', 'markdown', 'slash_commands']
    })
    this.sessionName = sessionName
    this.profileId = profileId || conversationStore.resolveProfileId(process.env.OWNER_ID, true)
    this.rl = null
  }

  /**
   * Format and print recent conversation history to the terminal.
   */
  _displayHistoryBacklog (limit = 4) {
    const history = conversationStore.getHistory(this.profileId, limit)
    if (!history || history.length === 0) return

    console.log('\n--- Recent Conversation History ---')
    for (const msg of history) {
      const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
      const sourceTag = msg.source === 'discord' ? ' [Discord/Phone]' : ''
      const author = msg.author || (msg.role === 'user' ? 'You' : (this.core?.botName || 'Skynet'))
      const timePrefix = timeStr ? `[${timeStr}${sourceTag}] ` : ''
      console.log(`${timePrefix}${author}: ${msg.content}`)
    }
    console.log('-----------------------------------\n')
  }

  async start (core) {
    await super.start(core)
    logger.info('CliAdapter: Initialized terminal REPL interface.')

    // Print welcome banner and recent conversation history
    console.log(`\n=== ${this.core.botName} Interactive Terminal ===`)
    console.log("Type your message or /command. Type 'exit' or 'quit' to exit.")
    this._displayHistoryBacklog(4)

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `${this.core.botName}> `
    })

    this.rl.prompt()

    this.rl.on('line', async (line) => {
      const input = line.trim()
      if (!input) {
        this.rl.prompt()
        return
      }

      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        console.log('Exiting CLI session.')
        this.rl.close()
        process.exit(0)
      }

      // Check if user entered a slash command (e.g. /tldr or /ping)
      if (input.startsWith('/')) {
        const parts = input.slice(1).split(/\s+/)
        const cmdName = parts[0]
        const argsStr = parts.slice(1).join(' ')

        const interaction = new NormalizedInteraction({
          clientId: 'cli',
          id: String(Date.now()),
          type: 'command',
          commandName: cmdName,
          user: { id: process.env.OWNER_ID || 'cli_owner', username: process.env.OWNER_NAME || process.env.USER || 'Sirian' },
          channel: { id: this.sessionName, name: this.sessionName },
          options: { input: argsStr },
          handlers: {
            reply: async (msg) => {
              const text = typeof msg === 'string' ? msg : (msg.content || JSON.stringify(msg, null, 2))
              console.log(`\n[${cmdName}]: ${text}\n`)
            },
            deferReply: async () => {},
            editReply: async (msg) => {
              const text = typeof msg === 'string' ? msg : (msg.content || JSON.stringify(msg, null, 2))
              console.log(`\n[${cmdName}]: ${text}\n`)
            }
          }
        })

        await this.core.dispatchInteraction(interaction)
        this.rl.prompt()
        return
      }

      // Standard conversational chat turn
      try {
        // Hydrate from conversationStore
        const storedHistory = conversationStore.getHistory(this.profileId, 20)
        const channelHistory = {
          messages: [
            { role: 'system', content: getBasePrompt() },
            ...storedHistory.map(m => ({
              role: m.role || 'user',
              content: m.author ? `@${m.author}: ${m.content}` : m.content
            })),
            { role: 'user', content: `@${process.env.OWNER_NAME || 'Sirian'}: ${input}` }
          ]
        }

        let hasStreamed = false
        const streamToken = (token) => {
          if (!hasStreamed) {
            process.stdout.write(`\n${this.core.botName}: `)
            hasStreamed = true
          }
          process.stdout.write(token)
        }

        const interaction = new NormalizedInteraction({
          clientId: 'cli',
          user: { id: process.env.OWNER_ID || 'cli_owner', username: process.env.OWNER_NAME || process.env.USER || 'Sirian' },
          channel: { id: this.sessionName, name: this.sessionName }
        })
        interaction.streamToken = streamToken

        const result = await this.core.turnManager.executeTurn({
          interaction,
          database: this.core.database,
          channelHistory,
          ollamaContext: {
            userId: process.env.OWNER_ID,
            guildId: null
          }
        })

        if (hasStreamed) {
          process.stdout.write('\n\n')
        } else {
          const replyText = result.replyContent || 'No response generated.'
          console.log(`\n${this.core.botName}: ${replyText}\n`)
        }

        // Persist turn to conversationStore
        conversationStore.appendMessage(this.profileId, {
          role: 'user',
          content: input,
          author: process.env.OWNER_NAME || 'Sirian',
          source: 'cli',
          timestamp: Date.now()
        })

        if (result.replyContent) {
          conversationStore.appendMessage(this.profileId, {
            role: 'assistant',
            content: result.replyContent,
            author: this.core.botName,
            source: 'local',
            timestamp: Date.now()
          })
        }
      } catch (err) {
        console.error(`\nCLI Error: ${err.message}\n`)
      }

      this.rl.prompt()
    })
  }

  async stop () {
    if (this.rl) {
      this.rl.close()
      this.rl = null
    }
    await super.stop()
  }

  async sendMessage (sessionId, payload) {
    const text = typeof payload === 'string' ? payload : (payload.content || JSON.stringify(payload))
    console.log(`\n[Notification]: ${text}\n`)
    if (this.rl) this.rl.prompt()
  }

  async getRecentHistory (sessionId, limit = 20) {
    return conversationStore.getHistory(this.profileId, limit)
  }

  async getActiveSessions () {
    return [{ id: this.sessionName, name: this.sessionName, isDM: true }]
  }
}

module.exports = CliAdapter
