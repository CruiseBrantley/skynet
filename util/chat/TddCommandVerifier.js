const fs = require('fs')
const path = require('path')
const logger = require('../../logger')

const TESTS_DIR = path.join(__dirname, '../../tests')

class TddCommandVerifier {
  /**
   * Generates mock Discord interaction for dry-run testing.
   */
  createMockInteraction (optionsMap = {}) {
    const responses = []
    const interaction = {
      id: 'mock_interaction_123',
      commandName: 'mock_cmd',
      user: { id: '111222333444555666', username: 'TestUser', tag: 'TestUser#0001' },
      member: {
        id: '111222333444555666',
        permissions: {
          has: () => true
        },
        voice: {
          channel: { id: '999888777', name: 'General Voice' }
        }
      },
      guild: {
        id: '525112230006489091',
        name: 'Test Server',
        members: { fetch: async (id) => ({ id, user: { username: 'User' } }) },
        channels: { fetch: async (id) => ({ id, name: 'general', send: async () => {} }), cache: new Map() }
      },
      channel: {
        id: '1234567890',
        name: 'bot-commands',
        send: async (payload) => {
          responses.push({ type: 'channel.send', payload })
          return { id: 'msg_1' }
        }
      },
      replied: false,
      deferred: false,
      reply: async (payload) => {
        interaction.replied = true
        responses.push({ type: 'reply', payload })
        return { id: 'reply_1' }
      },
      deferReply: async (payload) => {
        interaction.deferred = true
        responses.push({ type: 'deferReply', payload })
        return { id: 'defer_1' }
      },
      editReply: async (payload) => {
        responses.push({ type: 'editReply', payload })
        return { id: 'edit_1' }
      },
      followUp: async (payload) => {
        responses.push({ type: 'followUp', payload })
        return { id: 'follow_1' }
      },
      options: {
        getString: (name) => optionsMap[name] !== undefined ? String(optionsMap[name]) : 'test_string',
        getInteger: (name) => optionsMap[name] !== undefined ? parseInt(optionsMap[name]) : 1,
        getNumber: (name) => optionsMap[name] !== undefined ? parseFloat(optionsMap[name]) : 1.5,
        getBoolean: (name) => optionsMap[name] !== undefined ? Boolean(optionsMap[name]) : true,
        getUser: (name) => ({ id: '111222333444555666', username: 'TestUser' }),
        getChannel: (name) => ({ id: '1234567890', name: 'bot-commands', send: async () => {} }),
        getRole: (name) => ({ id: '777888999', name: 'Admin' }),
        getAttachment: (name) => ({ url: 'https://example.com/sound.mp3', name: 'sound.mp3' })
      },
      _responses: responses
    }
    return interaction
  }

  /**
   * Executes a dry-run test on generated slash command code in an isolated eval context.
   * @param {string} name - Command name
   * @param {string} fullModuleCode - The complete module code
   * @returns {Promise<{ passed: boolean, error?: string, responses?: Array }>}
   */
  async dryRunSlashCommand (name, fullModuleCode) {
    const { createRequire } = require('module')
    const commandRequire = createRequire(path.join(__dirname, '../../commands/stub.js'))

    try {
      // 1. Syntax check
      let compiledFactory
      try {
        compiledFactory = new Function('require', 'module', 'exports', '__dirname', '__filename', fullModuleCode) // eslint-disable-line no-new-func
      } catch (syntaxErr) {
        return { passed: false, error: `Syntax Error: ${syntaxErr.message}` }
      }

      // 2. Module instantiation
      const mockModule = { exports: {} }
      const mockExports = mockModule.exports
      try {
        compiledFactory(commandRequire, mockModule, mockExports, path.join(__dirname, '../../commands'), path.join(__dirname, `../../commands/${name}.js`))
      } catch (loadErr) {
        return { passed: false, error: `Module Load Error: ${loadErr.message}` }
      }

      const command = mockModule.exports
      if (!command || typeof command.execute !== 'function') {
        return { passed: false, error: 'Command module must export an async execute(interaction) function.' }
      }

      // 3. Dry-run execution with mock interaction
      const mockInteraction = this.createMockInteraction()
      try {
        let timer = null
        const timeoutPromise = new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Command execution timed out during dry-run test (5s limit)')), 5000)
          if (timer.unref) timer.unref()
        })

        await Promise.race([
          command.execute(mockInteraction),
          timeoutPromise
        ])
        if (timer) clearTimeout(timer)
      } catch (execErr) {
        return { passed: false, error: `Runtime Execution Error in execute(interaction): ${execErr.message}\n${execErr.stack || ''}` }
      }

      return {
        passed: true,
        responses: mockInteraction._responses
      }
    } catch (err) {
      return { passed: false, error: `TDD Validation Exception: ${err.message}` }
    }
  }

  /**
   * Generates and writes an automated Jest unit test file for the command.
   * @param {string} name - Command name
   */
  writeAutomatedUnitTest (name) {
    try {
      if (process.env.NODE_ENV === 'test' || name.startsWith('test_') || name.startsWith('tmp_')) {
        return null
      }
      if (!fs.existsSync(TESTS_DIR)) fs.mkdirSync(TESTS_DIR, { recursive: true })

      const testContent = `// Auto-generated TDD test for slash command /${name}
const command = require('../commands/${name}')

describe('Dynamic Slash Command: /${name}', () => {
  test('exports valid SlashCommandBuilder and execute handler', () => {
    expect(command).toBeDefined()
    expect(command.data).toBeDefined()
    expect(command.data.name).toBe('${name}')
    expect(typeof command.execute).toBe('function')
  })

  test('executes cleanly with mock interaction without uncaught errors', async () => {
    const mockInteraction = {
      commandName: '${name}',
      user: { id: '12345', username: 'TestUser' },
      member: { permissions: { has: () => true }, voice: { channel: { id: 'voice_1' } } },
      guild: { id: 'guild_1', members: { fetch: async () => ({}) }, channels: { fetch: async () => ({ send: async () => {} }) } },
      channel: { id: 'chan_1', send: async () => ({}) },
      reply: jest.fn().mockResolvedValue({}),
      deferReply: jest.fn().mockResolvedValue({}),
      editReply: jest.fn().mockResolvedValue({}),
      followUp: jest.fn().mockResolvedValue({}),
      options: {
        getString: jest.fn().mockReturnValue('test'),
        getInteger: jest.fn().mockReturnValue(1),
        getNumber: jest.fn().mockReturnValue(1.0),
        getBoolean: jest.fn().mockReturnValue(true),
        getUser: jest.fn().mockReturnValue({ id: '123' }),
        getChannel: jest.fn().mockReturnValue({ id: 'chan_1' }),
        getRole: jest.fn().mockReturnValue({ id: 'role_1' })
      }
    }

    await expect(command.execute(mockInteraction)).resolves.not.toThrow()
  })
})
`
      const testFilePath = path.join(TESTS_DIR, `dynamic_${name}.test.js`)
      fs.writeFileSync(testFilePath, testContent, 'utf8')
      logger.info(`TddCommandVerifier: Generated unit test suite at tests/dynamic_${name}.test.js`)
      return testFilePath
    } catch (err) {
      logger.warn(`TddCommandVerifier: Could not write test file for ${name}: ${err.message}`)
      return null
    }
  }
}

module.exports = new TddCommandVerifier()
