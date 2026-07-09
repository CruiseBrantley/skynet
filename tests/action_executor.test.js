const fs = require('fs')
const path = require('path')

const CUSTOM_DIR = path.join(__dirname, '../data/agent_actions')
const TEST_PREFIX = 'skynet_test_'

// Mock ollama and jsonrepair before ActionExecutor is loaded
jest.mock('../util/ollama', () => ({
  queryLocalOrRemote: jest.fn(),
  queryOllama: jest.fn()
}))
jest.mock('jsonrepair', () => ({ jsonrepair: s => s }))

describe('ActionExecutor', () => {
  let executor
  let mockOllama

  // Track test-created action names for cleanup
  const createdActions = new Set()

  const cleanup = () => {
    for (const name of createdActions) {
      const filePath = path.join(CUSTOM_DIR, `${name}.js`)
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath) } catch { }
      }
      if (executor?._actions) delete executor._actions[name]
    }
    createdActions.clear()
  }

  const register = (name, code = 'await channel.send(params.content || "test");') => {
    const fullName = `${TEST_PREFIX}${name}`
    createdActions.add(fullName)
    return executor.registerAction(fullName, `Test: ${name}`, { content: 'string' }, code)
  }

  beforeAll(() => {
    executor = require('../util/ActionExecutor')
    mockOllama = require('../util/ollama')
  })

  afterEach(() => {
    jest.clearAllMocks()
    cleanup()
  })

  // ─── listActions ───────────────────────────────────────────────────────────

  describe('listActions()', () => {
    test('includes all 4 built-in actions', () => {
      const names = executor.listActions().map(a => a.name)
      expect(names).toContain('send_message')
      expect(names).toContain('send_poll')
      expect(names).toContain('send_embed')
      expect(names).toContain('send_thread')
    })

    test('each action has name, description, and schema', () => {
      for (const action of executor.listActions()) {
        expect(action.name).toBeTruthy()
        expect(action.description).toBeTruthy()
        expect(action.schema).toBeDefined()
      }
    })
  })

  // ─── registerAction ────────────────────────────────────────────────────────

  describe('registerAction()', () => {
    test('successfully registers a valid action', () => {
      const result = register('hello')
      expect(result.success).toBe(true)
    })

    test('registered action appears in listActions()', () => {
      register('listed')
      const names = executor.listActions().map(a => a.name)
      expect(names).toContain(`${TEST_PREFIX}listed`)
    })

    test('persists action file to disk', () => {
      register('disk')
      const filePath = path.join(CUSTOM_DIR, `${TEST_PREFIX}disk.js`)
      expect(fs.existsSync(filePath)).toBe(true)
    })

    test('rejects invalid name (uppercase)', () => {
      const result = executor.registerAction('Bad_Name', 'x', {}, 'await channel.send("x");')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Name must be/)
    })

    test('rejects invalid name (starts with number)', () => {
      const result = executor.registerAction('1bad', 'x', {}, 'await channel.send("x");')
      expect(result.success).toBe(false)
    })

    test('rejects overwriting a built-in action', () => {
      const result = executor.registerAction('send_message', 'hijack', {}, 'await channel.send("evil");')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/built-in/)
    })

    test.each([
      ["require('fs')", "require('fs').readFileSync('/etc/passwd');"],
      ["require('child_process')", "require('child_process').exec('ls');"],
      ['process.exit', 'process.exit(1);'],
      ['eval', "eval('bad');"],
      ['new Function', "new Function('return 1')();"],
      ['process.env', 'const x = process.env.SECRET;']
    ])('blocks %s in action code', (_label, code) => {
      createdActions.add(`${TEST_PREFIX}bad`) // preemptive cleanup
      const result = executor.registerAction(`${TEST_PREFIX}bad`, 'x', {}, code)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Forbidden/)
    })

    test('rejects code with syntax errors', () => {
      createdActions.add(`${TEST_PREFIX}syntax`)
      const result = executor.registerAction(`${TEST_PREFIX}syntax`, 'x', {}, ';;; this is not valid {{{{')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Syntax error/)
    })

    test('allows valid async discord.js code', () => {
      const result = register('valid_async', `
                const msg = await channel.send({ content: params.question || 'Poll?' });
                return msg;
            `)
      expect(result.success).toBe(true)
    })
  })

  // ─── modifyAction ──────────────────────────────────────────────────────────

  describe('modifyAction()', () => {
    const modTarget = `${TEST_PREFIX}modme`

    beforeEach(() => {
      createdActions.add(modTarget)
      executor.registerAction(modTarget, 'Original description', { msg: 'string' }, 'await channel.send(params.msg);')
    })

    test('updates description only', () => {
      const result = executor.modifyAction(modTarget, { description: 'New description' })
      expect(result.success).toBe(true)
      // Verify the file on disk has the updated description
      const filePath = require('path').join(__dirname, '../data/agent_actions', `${modTarget}.js`)
      const fileContents = require('fs').readFileSync(filePath, 'utf8')
      expect(fileContents).toContain('New description')
    })

    test('updates code only — old description is preserved', () => {
      const result = executor.modifyAction(modTarget, { code: 'await channel.send("updated");' })
      expect(result.success).toBe(true)
      const a = executor.listActions().find(a => a.name === modTarget)
      expect(a.description).toBe('Original description')
    })

    test('updates schema only', () => {
      const newSchema = { msg: 'string', bold: 'boolean' }
      const result = executor.modifyAction(modTarget, { schema: newSchema })
      expect(result.success).toBe(true)
      // Schema is persisted to disk
      const filePath = require('path').join(__dirname, '../data/agent_actions', `${modTarget}.js`)
      const fileContents = require('fs').readFileSync(filePath, 'utf8')
      expect(fileContents).toContain('bold')
    })

    test('rejects modifying a built-in', () => {
      const result = executor.modifyAction('send_poll', { description: 'hacked' })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/built-in/)
    })

    test('rejects non-existent action', () => {
      const result = executor.modifyAction('no_such_action_xyz__test', { description: 'x' })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/No custom action/)
    })

    test('rejects forbidden code in update', () => {
      const result = executor.modifyAction(modTarget, { code: 'require(\'fs\').readFileSync(\'/x\');' })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Forbidden/)
    })

    test('rejects syntax error in updated code', () => {
      const result = executor.modifyAction(modTarget, { code: '}}}}}' })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Syntax error/)
    })

    test('updated file is reloaded immediately — no restart needed', () => {
      executor.modifyAction(modTarget, { description: 'Hot Reloaded' })
      // Verify it's reflected on disk (the in-memory singleton caches the module)
      const filePath = require('path').join(__dirname, '../data/agent_actions', `${modTarget}.js`)
      const fileContents = require('fs').readFileSync(filePath, 'utf8')
      expect(fileContents).toContain('Hot Reloaded')
    })
  })

  // ─── deleteAction ──────────────────────────────────────────────────────────

  describe('deleteAction()', () => {
    const delTarget = `${TEST_PREFIX}delme`

    beforeEach(() => {
      createdActions.add(delTarget)
      executor.registerAction(delTarget, 'To be deleted', {}, 'await channel.send("bye");')
    })

    test('successfully deletes a custom action', () => {
      const result = executor.deleteAction(delTarget)
      expect(result.success).toBe(true)
    })

    test('removed from listActions()', () => {
      executor.deleteAction(delTarget)
      expect(executor.listActions().map(a => a.name)).not.toContain(delTarget)
    })

    test('removes the file from disk', () => {
      executor.deleteAction(delTarget)
      expect(fs.existsSync(path.join(CUSTOM_DIR, `${delTarget}.js`))).toBe(false)
    })

    test('rejects deleting a built-in', () => {
      const result = executor.deleteAction('send_poll')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/built-in/)
    })

    test('rejects deleting a non-existent action', () => {
      const result = executor.deleteAction('no_such_thing_xyz__test')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/No custom action/)
    })
  })

  // ─── classify ─────────────────────────────────────────────────────────────

  describe('classify()', () => {
    test('parses action and params from Ollama JSON response', async () => {
      mockOllama.queryOllama.mockResolvedValue({
        message: { content: '{"action":"send_poll","params":{"question":"Vote?","options":["Yes","No"],"duration_hours":24}}' }
      })
      const result = await executor.classify({ description: 'Create a poll: Vote? Yes/No' })
      expect(result.action).toBe('send_poll')
      expect(result.params.question).toBe('Vote?')
      expect(result.params.options).toEqual(['Yes', 'No'])
    })

    test('extracts override_channel_id from Ollama response', async () => {
      mockOllama.queryOllama.mockResolvedValue({
        message: { content: '{"action":"send_poll","override_channel_id":"580867049006301214","params":{"question":"Vote?","options":["Yes","No"]}}' }
      })
      const result = await executor.classify({ description: 'Poll in <#580867049006301214>' })
      expect(result.override_channel_id).toBe('580867049006301214')
    })

    test('falls back to send_message on Ollama failure', async () => {
      mockOllama.queryOllama.mockRejectedValue(new Error('offline'))
      const result = await executor.classify({ description: 'Hello world!' })
      expect(result.action).toBe('send_message')
    })

    test('extracts channel mention from description text on fallback', async () => {
      mockOllama.queryOllama.mockRejectedValue(new Error('offline'))
      const result = await executor.classify({ description: 'Announce in <#987654321> that we are live' })
      expect(result.override_channel_id).toBe('987654321')
    })

    test('strips channel mention from fallback send_message content', async () => {
      mockOllama.queryOllama.mockRejectedValue(new Error('offline'))
      const result = await executor.classify({ description: 'Post in <#111222333> — Server is back online!' })
      expect(result.params.content).not.toContain('<#')
      expect(result.params.content).toContain('Server is back online!')
    })

    test('falls back gracefully when response has no JSON', async () => {
      mockOllama.queryOllama.mockResolvedValue({ message: { content: 'Sure, I will do that.' } })
      const result = await executor.classify({ description: 'Do something' })
      expect(result.action).toBe('send_message')
    })
  })

  // ─── resolveChannel ───────────────────────────────────────────────────────

  describe('resolveChannel()', () => {
    test('resolves a channel by ID from cache', async () => {
      const mockChannel = { id: '111', send: jest.fn() }
      const mockBot = {
        channels: { cache: { get: jest.fn().mockReturnValue(mockChannel) }, fetch: jest.fn() },
        users: { fetch: jest.fn() }
      }
      const result = await executor.resolveChannel(mockBot, { channelId: '111' }, null)
      expect(result).toBe(mockChannel)
      expect(mockBot.channels.cache.get).toHaveBeenCalledWith('111')
    })

    test('fetches channel from API if not in cache', async () => {
      const mockChannel = { id: '222' }
      const mockBot = {
        channels: { cache: { get: jest.fn().mockReturnValue(null) }, fetch: jest.fn().mockResolvedValue(mockChannel) },
        users: { fetch: jest.fn() }
      }
      const result = await executor.resolveChannel(mockBot, { channelId: '222' }, null)
      expect(result).toBe(mockChannel)
    })

    test('opens DM when channelId is "dm"', async () => {
      const mockDM = { send: jest.fn() }
      const mockUser = { createDM: jest.fn().mockResolvedValue(mockDM) }
      const mockBot = {
        channels: { cache: { get: jest.fn() } },
        users: { fetch: jest.fn().mockResolvedValue(mockUser) }
      }
      const result = await executor.resolveChannel(mockBot, { channelId: 'dm', userId: '999' }, null)
      expect(result).toBe(mockDM)
    })

    test('override_channel_id takes priority over task.channelId', async () => {
      const overrideChannel = { id: '555' }
      const mockBot = {
        channels: { cache: { get: jest.fn().mockReturnValue(overrideChannel) }, fetch: jest.fn() },
        users: { fetch: jest.fn() }
      }
      const result = await executor.resolveChannel(mockBot, { channelId: 'dm', userId: '999' }, '555')
      expect(mockBot.channels.cache.get).toHaveBeenCalledWith('555')
      expect(result).toBe(overrideChannel)
    })

    test('returns null if user not found for DM delivery', async () => {
      const mockBot = {
        channels: { cache: { get: jest.fn() } },
        users: { fetch: jest.fn().mockResolvedValue(null) }
      }
      const result = await executor.resolveChannel(mockBot, { channelId: 'dm', userId: 'missing' }, null)
      expect(result).toBeNull()
    })
  })
})
