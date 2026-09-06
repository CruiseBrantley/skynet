#!/usr/bin/env node
const SkynetCore = require('./core/SkynetCore')
const CliAdapter = require('./clients/CliAdapter')
const conversationStore = require('./core/conversationStore')
const { getBasePrompt } = require('./util/systemPrompt')
const logger = require('./logger')

async function main () {
  const args = process.argv.slice(2)
  const isOneShot = args.length > 0
  const messageInput = args.join(' ').replace(/^--message\s+|^--msg\s+|-m\s+/, '')

  const core = new SkynetCore({ isDaemon: false })
  await core.init()

  const profileId = conversationStore.resolveProfileId(process.env.OWNER_ID, true)

  if (isOneShot) {
    const storedHistory = conversationStore.getHistory(profileId, 20)
    const channelHistory = {
      messages: [
        { role: 'system', content: getBasePrompt() },
        ...storedHistory.map(m => ({
          role: m.role || 'user',
          content: m.author ? `@${m.author}: ${m.content}` : m.content
        })),
        { role: 'user', content: `@${process.env.OWNER_NAME || 'Sirian'}: ${messageInput}` }
      ]
    }

    const { createStatusHeartbeat } = require('./util/chat/statusHeartbeat')

    let hasStreamed = false
    let heartbeat = null

    const streamToken = (token) => {
      if (heartbeat) {
        heartbeat.stop()
        heartbeat = null
        process.stdout.write('\r\x1b[K') // Clear live status line
      }
      if (!hasStreamed) {
        process.stdout.write(`\n${core.botName}: `)
        hasStreamed = true
      }
      process.stdout.write(token)
    }

    const NormalizedInteraction = require('./interfaces/NormalizedInteraction')
    const interaction = new NormalizedInteraction({
      clientId: 'cli',
      user: { id: process.env.OWNER_ID || 'cli_owner', username: process.env.OWNER_NAME || process.env.USER || 'Sirian' },
      channel: { id: 'terminal', name: 'terminal' }
    })
    interaction.streamToken = streamToken
    interaction.showStatus = async (text) => {
      if (hasStreamed) return
      if (!heartbeat) {
        heartbeat = createStatusHeartbeat(async (payload) => {
          if (hasStreamed) return
          const statusText = typeof payload === 'string' ? payload : (payload.content || '')
          process.stdout.write(`\r\x1b[K\x1b[90m${statusText}\x1b[0m`)
        }, text)
        await heartbeat.start()
      } else {
        await heartbeat.updateStatus(text)
      }
    }

    const result = await core.turnManager.executeTurn({
      interaction,
      database: core.database,
      channelHistory,
      ollamaContext: {
        userId: process.env.OWNER_ID,
        guildId: null
      }
    })

    if (hasStreamed) {
      process.stdout.write('\n\n')
    } else {
      console.log(`\n${core.botName}: ${result.replyContent || 'No response generated.'}\n`)
    }

    // Persist one-shot turn
    conversationStore.appendMessage(profileId, {
      role: 'user',
      content: messageInput,
      author: process.env.OWNER_NAME || 'Sirian',
      source: 'cli',
      timestamp: Date.now()
    })

    if (result.replyContent) {
      conversationStore.appendMessage(profileId, {
        role: 'assistant',
        content: result.replyContent,
        author: core.botName,
        source: 'local',
        timestamp: Date.now()
      })
    }

    process.exit(0)
  }

  const cli = new CliAdapter({ sessionName: 'terminal', profileId })
  await core.registerClient(cli)
}

main().catch((err) => {
  logger.error(`Skynet CLI error: ${err.stack || err.message}`)
  process.exit(1)
})
