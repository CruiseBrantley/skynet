const path = require('path')
const fs = require('fs')
const ActionExecutor = require('../util/ActionExecutor')
const AgentTurnManager = require('../util/chat/AgentTurnManager')

describe('Owner-Only Host Tools & RBAC Suite', () => {
  const OWNER_ID = '199749017150816256'
  const NON_OWNER_ID = '987654321987654321'
  const tempTestFile = path.join(__dirname, '../data/test_host_tool.txt')

  beforeAll(() => {
    process.env.OWNER_ID = OWNER_ID
  })

  afterAll(() => {
    if (fs.existsSync(tempTestFile)) {
      fs.unlinkSync(tempTestFile)
    }
  })

  describe('ActionExecutor.listActions & Catalog Filtering', () => {
    test('excludes ownerOnly tools for non-owners', () => {
      const publicActions = ActionExecutor.listActions({ isOwner: false })
      const actionNames = publicActions.map(a => a.name)
      expect(actionNames).not.toContain('host_read_file')
      expect(actionNames).not.toContain('host_write_file')
      expect(actionNames).not.toContain('host_exec')
      expect(actionNames).toContain('web_search')
      expect(actionNames).toContain('read_state')
    })

    test('includes ownerOnly tools for owner', () => {
      const ownerActions = ActionExecutor.listActions({ isOwner: true })
      const actionNames = ownerActions.map(a => a.name)
      expect(actionNames).toContain('host_read_file')
      expect(actionNames).toContain('host_write_file')
      expect(actionNames).toContain('host_exec')
    })

    test('AgentTurnManager.getToolCatalogPrompt excludes owner tools for non-owner', () => {
      const catalog = AgentTurnManager.getToolCatalogPrompt({ isOwner: false })
      expect(catalog).not.toContain('host_read_file')
      expect(catalog).not.toContain('host_exec')
      expect(catalog).toContain('read_state')
    })

    test('AgentTurnManager.getToolCatalogPrompt includes owner tools in private session for owner', () => {
      const catalog = AgentTurnManager.getToolCatalogPrompt({ isOwner: true, isDM: true })
      expect(catalog).toContain('host_read_file')
      expect(catalog).toContain('host_write_file')
      expect(catalog).toContain('host_exec')
    })

    test('AgentTurnManager.getToolCatalogPrompt excludes owner tools in public guild even for owner', () => {
      const catalog = AgentTurnManager.getToolCatalogPrompt({ isOwner: true, isDM: false, guildId: 'guild-123' })
      expect(catalog).not.toContain('host_read_file')
      expect(catalog).not.toContain('host_exec')
    })
  })

  describe('Execution Authorization Enforcement', () => {
    test('rejects host_exec when called by non-owner', async () => {
      const result = await ActionExecutor.executeAction('host_exec', { command: 'echo "hello"' }, {
        userId: NON_OWNER_ID,
        isOwner: false,
        isDM: true
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('Access Denied')
      expect(result.error).toContain('strictly restricted to the bot owner')
    })

    test('rejects host_exec in public server channel even when called by owner', async () => {
      const result = await ActionExecutor.executeAction('host_exec', { command: 'echo "hello"' }, {
        userId: OWNER_ID,
        isOwner: true,
        guildId: 'guild-123',
        isDM: false
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('Access Denied')
      expect(result.error).toContain('private 1-on-1 sessions')
    })

    test('successfully writes and reads file via host_write_file and host_read_file for owner in private session', async () => {
      const writeResult = await ActionExecutor.executeAction('host_write_file', {
        file_path: tempTestFile,
        content: 'Hello Skynet Host RBAC Test\nLine 2 of test'
      }, {
        userId: OWNER_ID,
        isOwner: true,
        isDM: true
      })

      expect(writeResult.success).toBe(true)
      expect(writeResult.output).toContain('Successfully wrote')
      expect(fs.existsSync(tempTestFile)).toBe(true)

      const readResult = await ActionExecutor.executeAction('host_read_file', {
        file_path: tempTestFile
      }, {
        userId: OWNER_ID,
        isOwner: true,
        isDM: true
      })

      expect(readResult.success).toBe(true)
      expect(readResult.output).toContain('Hello Skynet Host RBAC Test')
    })

    test('successfully executes command via host_exec for owner in private session', async () => {
      const execResult = await ActionExecutor.executeAction('host_exec', {
        command: 'echo "skynet_rbac_verified"'
      }, {
        userId: OWNER_ID,
        isOwner: true,
        isDM: true
      })

      expect(execResult.success).toBe(true)
      expect(execResult.output).toContain('skynet_rbac_verified')
      expect(execResult.output).toContain('exit code 0')
    })
  })

  describe('System Prompt & AGENTS.md Protocol Integration', () => {
    const { getBasePrompt } = require('../util/systemPrompt')

    test('getBasePrompt excludes AGENTS.md for non-owner', () => {
      const prompt = getBasePrompt({ isOwner: false })
      expect(prompt).not.toContain('### AGENT WORKFLOW & VERIFICATION PROTOCOL (AGENTS.md) ###')
    })

    test('getBasePrompt injects AGENTS.md and verification protocol for owner', () => {
      const prompt = getBasePrompt({ isOwner: true, isDM: true })
      expect(prompt).toContain('### AGENT WORKFLOW & VERIFICATION PROTOCOL (AGENTS.md) ###')
      expect(prompt).toContain('## Verification')
      expect(prompt).toContain('CODE MODIFICATION & VERIFICATION PROTOCOL')
    })
  })
})
