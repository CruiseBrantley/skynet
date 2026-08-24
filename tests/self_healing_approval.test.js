const selfHealing = require('../util/chat/SelfHealingEngine')
const ollama = require('../util/ollama')
const commandManager = require('../util/commandManager')
const { createMockInteraction } = require('../util/chat/createMockInteraction')
const netstatsCommand = require('../commands/netstats')

jest.mock('../logger')

describe('SelfHealingEngine Owner Approval Workflow & Mock Resilience', () => {
  const originalOwnerId = process.env.OWNER_ID

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

  test('proposeSlashCommandFix generates a proposal and sends approval card', async () => {
    jest.spyOn(commandManager, 'inspectSlashCommand').mockReturnValue({
      success: true,
      content: 'module.exports = { data: {}, execute: async () => { throw new Error("test"); } }'
    })

    jest.spyOn(ollama, 'queryCodeCapableModel').mockResolvedValue({
      message: {
        content: JSON.stringify({
          reasoning: 'Fixed missing deferReply handling.',
          fixed_code: 'module.exports = { data: {}, execute: async (i) => { await i.reply("fixed"); } }'
        })
      }
    })

    const mockSend = jest.fn().mockResolvedValue({})
    const mockInteraction = {
      user: { id: 'owner-12345' },
      channel: { send: mockSend },
      guildId: 'g-1',
      client: {}
    }

    const result = await selfHealing.proposeSlashCommandFix({
      commandName: 'broken_cmd',
      error: new Error('test error'),
      interaction: mockInteraction
    })

    expect(result.success).toBe(true)
    expect(result.proposalId).toBeDefined()
    expect(selfHealing.pendingProposals.has(result.proposalId)).toBe(true)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
      components: expect.any(Array)
    }))
  })

  test('applyPendingRepair rejects unauthorized non-owner users', async () => {
    selfHealing.pendingProposals.set('repair_test_1', {
      proposalId: 'repair_test_1',
      targetType: 'slash',
      name: 'broken_cmd',
      fixedCode: 'code',
      reasoning: 'fix',
      error: 'err',
      timestamp: Date.now()
    })

    const res = await selfHealing.applyPendingRepair('repair_test_1', 'unauthorized-user-999', {})
    expect(res.success).toBe(false)
    expect(res.error).toContain('Unauthorized')
    expect(selfHealing.pendingProposals.has('repair_test_1')).toBe(true)
  })

  test('applyPendingRepair applies fix when authorized by owner', async () => {
    jest.spyOn(commandManager, 'createSlashCommand').mockResolvedValue({ success: true })

    selfHealing.pendingProposals.set('repair_test_2', {
      proposalId: 'repair_test_2',
      targetType: 'slash',
      name: 'broken_cmd',
      fixedCode: 'code',
      reasoning: 'Fixed deferReply bug',
      error: 'err',
      guildId: 'g1',
      isGlobal: false,
      timestamp: Date.now()
    })

    const res = await selfHealing.applyPendingRepair('repair_test_2', 'owner-12345', {})
    expect(res.success).toBe(true)
    expect(res.name).toBe('broken_cmd')
    expect(selfHealing.pendingProposals.has('repair_test_2')).toBe(false)
    expect(commandManager.createSlashCommand).toHaveBeenCalledWith(expect.objectContaining({
      name: 'broken_cmd',
      code: 'code'
    }))
  })

  test('rejectPendingRepair cancels and removes pending proposal', async () => {
    selfHealing.pendingProposals.set('repair_test_3', {
      proposalId: 'repair_test_3',
      name: 'broken_cmd'
    })

    const res = await selfHealing.rejectPendingRepair('repair_test_3', 'owner-12345')
    expect(res.success).toBe(true)
    expect(selfHealing.pendingProposals.has('repair_test_3')).toBe(false)
  })

  test('createMockInteraction deferReply returns valid timestamp and netstats executes without error', async () => {
    const rawInteraction = {
      id: 'i-1',
      channelId: 'c-1',
      user: { id: 'u-1' },
      editReply: jest.fn().mockResolvedValue({}),
      followUp: jest.fn().mockResolvedValue({}),
      deleteReply: jest.fn().mockResolvedValue({}),
      client: {
        ws: { ping: 15 },
        uptime: 10000,
        guilds: { cache: { size: 3 } }
      }
    }

    const mock = createMockInteraction(rawInteraction)
    const deferRes = await mock.deferReply({ fetchReply: true })
    expect(deferRes).toBeDefined()
    expect(typeof deferRes.createdTimestamp).toBe('number')

    // Execute netstats with the mock interaction
    await expect(netstatsCommand.execute(mock)).resolves.not.toThrow()
    expect(rawInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.arrayContaining([
        expect.objectContaining({
          title: 'Network Statistics'
        })
      ])
    }))
  })

  test('proposeActionFix generates a proposal and delivers card via DM when not in owner channel', async () => {
    jest.spyOn(ollama, 'queryCodeCapableModel').mockResolvedValue({
      message: {
        content: JSON.stringify({
          reasoning: 'Fixed missing parameter handling.',
          fixed_code: 'await channel.send("Action output: " + params.item);'
        })
      }
    })

    const mockOwnerSend = jest.fn().mockResolvedValue({})
    const mockClient = {
      users: {
        fetch: jest.fn().mockResolvedValue({
          send: mockOwnerSend
        })
      }
    }

    const result = await selfHealing.proposeActionFix({
      actionName: 'custom_action',
      description: 'Custom action description',
      schema: { item: 'string' },
      code: 'channel.send(item);',
      error: new Error('item is not defined'),
      params: { item: 'sword' },
      client: mockClient
    })

    expect(result.success).toBe(true)
    expect(result.proposalId).toBeDefined()
    expect(mockClient.users.fetch).toHaveBeenCalledWith('owner-12345')
    expect(mockOwnerSend).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
      components: expect.any(Array)
    }))

    // Approve the action repair
    const actionExecutor = require('../util/ActionExecutor')
    jest.spyOn(actionExecutor, 'registerAction').mockReturnValue({ success: true })

    const appRes = await selfHealing.applyPendingRepair(result.proposalId, 'owner-12345')
    expect(appRes.success).toBe(true)
    expect(appRes.targetType).toBe('action')
    expect(appRes.name).toBe('custom_action')
  })

  test('createMockInteraction handles string and embed replies, followUp, and options getters', async () => {
    const rawInteraction = {
      id: 'i-2',
      channel: { name: 'general', toString: () => '#general' },
      editReply: jest.fn().mockResolvedValue({}),
      followUp: jest.fn().mockResolvedValue({}),
      deleteReply: jest.fn().mockResolvedValue({})
    }

    const mock = createMockInteraction(rawInteraction, {
      getString: (k) => (k === 'opt' ? 'val' : null),
      getInteger: (k) => (k === 'num' ? 42 : null),
      getBoolean: (k) => (k === 'flag' ? true : false)
    })

    expect(mock.options.getString('opt')).toBe('val')
    expect(mock.options.getInteger('num')).toBe(42)
    expect(mock.options.getBoolean('flag')).toBe(true)
    expect(mock.toString()).toBe('#general')

    // Initial reply
    await mock.reply('First message')
    expect(rawInteraction.editReply).toHaveBeenCalledWith('First message')

    // Second text reply merges into editReply
    await mock.reply('Second message')
    expect(rawInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'First message\nSecond message'
    }))

    // Embed followUp uses rawInteraction.followUp
    await mock.followUp({ embeds: [{ title: 'New Embed' }] })
    expect(rawInteraction.followUp).toHaveBeenCalledWith({ embeds: [{ title: 'New Embed' }] })

    // Delete reply
    await mock.deleteReply()
    expect(rawInteraction.deleteReply).toHaveBeenCalled()
  })
})
