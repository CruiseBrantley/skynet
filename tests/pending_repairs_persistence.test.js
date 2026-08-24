const fs = require('fs')
const path = require('path')
const selfHealing = require('../util/chat/SelfHealingEngine')
const commandManager = require('../util/commandManager')
const actionExecutor = require('../util/ActionExecutor')

jest.mock('../logger')

describe('SelfHealingEngine Persistence, Backups & Rollback', () => {
  const originalOwnerId = process.env.OWNER_ID
  const PROPOSALS_FILE = path.join(__dirname, '../data/pending_repairs.json')
  const BACKUPS_DIR = path.join(__dirname, '../data/command_backups')

  beforeAll(() => {
    process.env.OWNER_ID = 'owner-12345'
  })

  afterAll(() => {
    process.env.OWNER_ID = originalOwnerId
  })

  beforeEach(() => {
    jest.clearAllMocks()
    selfHealing.pendingProposals.clear()
  })

  test('saves proposals to disk and reloads them on engine instantiation', () => {
    selfHealing.pendingProposals.set('repair_test_persist', {
      proposalId: 'repair_test_persist',
      targetType: 'slash',
      name: 'test_cmd',
      fixedCode: 'code',
      reasoning: 'reason',
      error: 'err',
      timestamp: Date.now()
    })

    selfHealing._saveProposals()
    expect(fs.existsSync(PROPOSALS_FILE)).toBe(true)

    // Clear and reload
    selfHealing.pendingProposals.clear()
    selfHealing._loadProposals()

    expect(selfHealing.pendingProposals.has('repair_test_persist')).toBe(true)
    const p = selfHealing.pendingProposals.get('repair_test_persist')
    expect(p.name).toBe('test_cmd')
  })

  test('creates backup snapshot before applying repair and allows owner rollback', async () => {
    // Create a mock original slash command file in commands/
    const originalCmdPath = path.join(__dirname, '../commands/dummy_rollback_cmd.js')
    const originalCode = 'module.exports = { data: {}, execute: async () => "original" };'
    fs.writeFileSync(originalCmdPath, originalCode, 'utf8')

    jest.spyOn(commandManager, 'createSlashCommand').mockResolvedValue({ success: true })

    selfHealing.pendingProposals.set('repair_dummy_rollback', {
      proposalId: 'repair_dummy_rollback',
      targetType: 'slash',
      name: 'dummy_rollback_cmd',
      fixedCode: 'module.exports = { data: {}, execute: async () => "patched" };',
      reasoning: 'Applied patch',
      error: 'err',
      timestamp: Date.now()
    })

    const applyRes = await selfHealing.applyPendingRepair('repair_dummy_rollback', 'owner-12345', {})
    expect(applyRes.success).toBe(true)
    expect(applyRes.backupId).toBeDefined()
    expect(fs.existsSync(path.join(BACKUPS_DIR, `${applyRes.backupId}.bak.js`))).toBe(true)

    // Verify backup content matches the original
    const backupContent = fs.readFileSync(path.join(BACKUPS_DIR, `${applyRes.backupId}.bak.js`), 'utf8')
    expect(backupContent).toBe(originalCode)

    // Attempt rollback as non-owner (should fail)
    const unauthorizedRollback = await selfHealing.rollbackRepair(applyRes.backupId, 'non-owner-user', {})
    expect(unauthorizedRollback.success).toBe(false)
    expect(unauthorizedRollback.error).toContain('Unauthorized')

    // Execute rollback as owner
    const rollbackRes = await selfHealing.rollbackRepair(applyRes.backupId, 'owner-12345', {})
    expect(rollbackRes.success).toBe(true)
    expect(rollbackRes.name).toBe('dummy_rollback_cmd')
    expect(commandManager.createSlashCommand).toHaveBeenCalledWith(expect.objectContaining({
      name: 'dummy_rollback_cmd',
      code: originalCode
    }))

    // Cleanup dummy file and backup
    if (fs.existsSync(originalCmdPath)) fs.unlinkSync(originalCmdPath)
    if (fs.existsSync(path.join(BACKUPS_DIR, `${applyRes.backupId}.bak.js`))) {
      fs.unlinkSync(path.join(BACKUPS_DIR, `${applyRes.backupId}.bak.js`))
    }
  })

  test('rollback handles dynamic actions correctly', async () => {
    const actionDir = path.join(__dirname, '../data/agent_actions')
    if (!fs.existsSync(actionDir)) fs.mkdirSync(actionDir, { recursive: true })
    const actionPath = path.join(actionDir, 'dummy_act.js')
    const originalCode = 'module.exports = { name: "dummy_act", execute: async () => "act" };'
    fs.writeFileSync(actionPath, originalCode, 'utf8')

    jest.spyOn(actionExecutor, 'registerAction').mockReturnValue({ success: true })

    selfHealing.pendingProposals.set('repair_dummy_act', {
      proposalId: 'repair_dummy_act',
      targetType: 'action',
      name: 'dummy_act',
      description: 'desc',
      schema: {},
      fixedCode: 'module.exports = { name: "dummy_act", execute: async () => "fixed" };',
      reasoning: 'Fixed action',
      error: 'err',
      timestamp: Date.now()
    })

    const applyRes = await selfHealing.applyPendingRepair('repair_dummy_act', 'owner-12345', {})
    expect(applyRes.success).toBe(true)
    expect(applyRes.backupId).toBeDefined()

    const rollbackRes = await selfHealing.rollbackRepair(applyRes.backupId, 'owner-12345', {})
    expect(rollbackRes.success).toBe(true)
    expect(rollbackRes.targetType).toBe('action')
    expect(actionExecutor.registerAction).toHaveBeenCalledWith('dummy_act', 'dummy_act', {}, originalCode)

    if (fs.existsSync(actionPath)) fs.unlinkSync(actionPath)
    if (fs.existsSync(path.join(BACKUPS_DIR, `${applyRes.backupId}.bak.js`))) {
      fs.unlinkSync(path.join(BACKUPS_DIR, `${applyRes.backupId}.bak.js`))
    }
  })
})
