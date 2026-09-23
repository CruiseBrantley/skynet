const workflowEngine = require('../util/WorkflowEngine')
const actionExecutor = require('../util/ActionExecutor')
const manageWorkflowsAction = require('../util/actions/manage_workflows')
const stateStore = require('../core/state')

jest.mock('../logger')

describe('WorkflowEngine & Multi-Step Pipelines', () => {
  beforeEach(() => {
    workflowEngine._workflows = []
    jest.spyOn(workflowEngine, '_save').mockImplementation(() => {})
  })

  test('creates, lists, and executes multi-step workflow with variable passing and conditions', async () => {
    // Mock action executions
    const mockStep1 = jest.fn().mockResolvedValue('Latest News: Diablo 4 Patch 2.1')
    const mockStep2 = jest.fn().mockResolvedValue('Saved successfully')

    jest.spyOn(actionExecutor, 'executeAction').mockImplementation(async (actionName, bot, channel, params) => {
      if (actionName === 'mock_fetch') return mockStep1(params)
      if (actionName === 'mock_save') return mockStep2(params)
      return 'ok'
    })

    const wf = workflowEngine.createWorkflow({
      name: 'test_pipeline',
      description: 'Test multi-step pipeline',
      steps: [
        {
          name: 'step1',
          action: 'mock_fetch',
          params: { query: 'd4 patch' }
        },
        {
          name: 'step2',
          action: 'mock_save',
          condition: 'truthy',
          params: { data: '$step1.result', inline: 'Prefix: $results' }
        }
      ]
    })

    expect(wf.id).toBeDefined()
    expect(workflowEngine.listWorkflows().length).toBe(1)

    const result = await workflowEngine.executeWorkflow('test_pipeline', { bot: {}, channel: { id: 'c123' } })
    expect(result.success).toBe(true)
    expect(result.executionLogs.length).toBe(2)
    expect(mockStep1).toHaveBeenCalledWith(expect.objectContaining({ query: 'd4 patch' }))
    expect(mockStep2).toHaveBeenCalledWith(expect.objectContaining({
      data: 'Latest News: Diablo 4 Patch 2.1',
      inline: 'Prefix: Latest News: Diablo 4 Patch 2.1'
    }))

    actionExecutor.executeAction.mockRestore()
  })

  test('manage_workflows action handles create, list, run, and delete', async () => {
    const createRes = await manageWorkflowsAction.execute({}, {}, {
      action: 'create',
      name: 'news_digest',
      steps: [{ name: 's1', action: 'add_reaction', params: { emoji: '👍' } }]
    })
    expect(createRes).toContain('Successfully created multi-step workflow')

    const listRes = await manageWorkflowsAction.execute({}, {}, { action: 'list' })
    expect(listRes).toContain('news_digest')

    const deleteRes = await manageWorkflowsAction.execute({}, {}, { action: 'delete', name: 'news_digest' })
    expect(deleteRes).toContain('Successfully deleted workflow')
  })

  test('skips step when $steps.<name>.output.hasChanged == true evaluates to false and runs when true', async () => {
    const mockSearch = jest.fn().mockResolvedValue('Patch 14.19 live notes')
    const mockDiffNoChange = jest.fn().mockResolvedValue({ hasChanged: false, previousValue: '14.18', newValue: '14.18' })
    const mockPost = jest.fn().mockResolvedValue('Embed sent')

    jest.spyOn(actionExecutor, 'executeAction').mockImplementation(async (actionName, bot, channel, params) => {
      if (actionName === 'mock_search') return mockSearch(params)
      if (actionName === 'mock_diff') return mockDiffNoChange(params)
      if (actionName === 'mock_post') return mockPost(params)
      return 'ok'
    })

    const wf = workflowEngine.createWorkflow({
      name: 'patch_pipeline',
      description: 'Test patch pipeline',
      steps: [
        {
          name: 'search_patch',
          action: 'mock_search',
          params: { query: 'LoL patch notes' }
        },
        {
          name: 'compare_baseline',
          action: 'mock_diff',
          params: { compare_with: '$steps.search_patch.output' }
        },
        {
          name: 'post_embed',
          action: 'mock_post',
          condition: '$steps.compare_baseline.output.hasChanged == true',
          params: { content: '$steps.search_patch.output' }
        }
      ]
    })

    // Run 1: hasChanged is false -> mock_post should be skipped!
    const res1 = await workflowEngine.executeWorkflow(wf.id, { bot: {}, channel: { id: 'c123' } })
    expect(res1.success).toBe(true)
    expect(mockPost).not.toHaveBeenCalled()
    expect(res1.executionLogs.some(log => log.includes('Condition "$steps.compare_baseline.output.hasChanged == true" evaluated to false, skipped'))).toBe(true)

    // Run 2: hasChanged is true -> mock_post should run!
    mockDiffNoChange.mockResolvedValueOnce({ hasChanged: true, previousValue: '14.18', newValue: '14.19' })
    const res2 = await workflowEngine.executeWorkflow(wf.id, { bot: {}, channel: { id: 'c123' } })
    expect(res2.success).toBe(true)
    expect(mockPost).toHaveBeenCalledTimes(1)
    expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ content: 'Patch 14.19 live notes' }))

    actionExecutor.executeAction.mockRestore()
  })

  test('extracts patch version dynamically from text with $steps.<name>.patch', async () => {
    const mockStep1 = jest.fn().mockResolvedValue('League of Legends Patch 26.18 is now live with Hall of Legends Caps')
    const mockStep2 = jest.fn().mockResolvedValue('ok')

    jest.spyOn(actionExecutor, 'executeAction').mockImplementation(async (actionName, bot, channel, params) => {
      if (actionName === 'mock_step1') return mockStep1(params)
      if (actionName === 'mock_step2') return mockStep2(params)
      return 'ok'
    })

    const wf = workflowEngine.createWorkflow({
      name: 'patch_version_test',
      description: 'Extract patch version',
      steps: [
        { name: 'search', action: 'mock_step1' },
        { name: 'save', action: 'mock_step2', params: { version: '$steps.search.patch', title: 'New Patch $steps.search.patch!' } }
      ]
    })

    const res = await workflowEngine.executeWorkflow(wf.id, { bot: {}, channel: { id: 'c123' } })
    expect(res.success).toBe(true)
    expect(mockStep2).toHaveBeenCalledWith(expect.objectContaining({
      version: '26.18',
      title: 'New Patch 26.18!'
    }))

    actionExecutor.executeAction.mockRestore()
  })

  test('extractVersionOrPatch correctly extracts patch numbers across various formats', () => {
    const { extractVersionOrPatch } = workflowEngine.constructor

    // Colon format from distilled Gemini outputs
    expect(extractVersionOrPatch('**Current Patch: 26.18**')).toBe('26.18')
    expect(extractVersionOrPatch('Latest Patch: 26.18')).toBe('26.18')
    expect(extractVersionOrPatch('Patch: 26.18 is live')).toBe('26.18')

    // Multiple versions in raw search results — picks highest/newest, not the first
    const multiVersionText = 'League of Legends Patch 26.16 Notes Champion updates... League of Legends Patch 26.18 Notes Congratulations, Caps!'
    expect(extractVersionOrPatch(multiVersionText)).toBe('26.18')

    // v-prefix format
    expect(extractVersionOrPatch('Released v14.19 with new skins')).toBe('14.19')

    // No patch in text
    expect(extractVersionOrPatch('General discussion about champions with no version')).toBeNull()
    expect(extractVersionOrPatch(null)).toBeNull()
  })

  test('lol_patch_checker pipeline prevents duplicate and stale patch announcements', async () => {
    stateStore.set('lol_patch_baseline', '26.18')

    const mockSearch = jest.fn()
    const mockSendEmbed = jest.fn()
    const mockWriteState = jest.fn()

    jest.spyOn(actionExecutor, 'executeAction').mockImplementation(async (actionName, bot, channel, params, context) => {
      if (actionName === 'web_search') return mockSearch(params)
      if (actionName === 'read_state') {
        const readState = require('../util/actions/read_state')
        return readState.execute(bot, channel, params, context)
      }
      if (actionName === 'send_embed') return mockSendEmbed(params)
      if (actionName === 'write_state') return mockWriteState(params)
      return 'ok'
    })

    const patchWf = workflowEngine.createWorkflow({
      name: 'lol_patch_checker_test',
      description: 'End to end patch checker test',
      steps: [
        {
          name: 'search_latest_patch',
          action: 'web_search',
          params: { query: 'latest League of Legends patch notes summary' }
        },
        {
          name: 'compare_patch_baseline',
          action: 'read_state',
          params: { key: 'lol_patch_baseline', compare_with: '$steps.search_latest_patch.patch' }
        },
        {
          name: 'post_patch_tldr',
          action: 'send_embed',
          condition: '$steps.compare_patch_baseline.output.hasChanged == true',
          params: { title: 'New Patch $steps.search_latest_patch.patch', description: '$steps.search_latest_patch.output' }
        },
        {
          name: 'update_patch_baseline',
          action: 'write_state',
          condition: '$steps.compare_patch_baseline.output.hasChanged == true',
          params: { key: 'lol_patch_baseline', value: '$steps.search_latest_patch.patch' }
        }
      ]
    })

    // Scenario 1: Distilled output returns same patch (26.18) -> NO post
    mockSearch.mockResolvedValueOnce('## Summary\n**Current Patch: 26.18**\nBalance updates.')
    let res = await workflowEngine.executeWorkflow(patchWf.id, { bot: {}, channel: { id: 'c123' } })
    expect(res.success).toBe(true)
    expect(mockSendEmbed).not.toHaveBeenCalled()
    expect(mockWriteState).not.toHaveBeenCalled()

    // Scenario 2: Search returns raw extracts with older patch first (26.16 & 26.18) -> NO post
    mockSearch.mockResolvedValueOnce('Patch 26.16 Notes Champion updates... Patch 26.18 Notes Caps Hall of Legends')
    res = await workflowEngine.executeWorkflow(patchWf.id, { bot: {}, channel: { id: 'c123' } })
    expect(res.success).toBe(true)
    expect(mockSendEmbed).not.toHaveBeenCalled()
    expect(mockWriteState).not.toHaveBeenCalled()

    // Scenario 3: Search returns only stale older patch (26.16) -> NO post (monotonicity guard)
    mockSearch.mockResolvedValueOnce('Patch 26.16 Notes Champion updates and bugfixes.')
    res = await workflowEngine.executeWorkflow(patchWf.id, { bot: {}, channel: { id: 'c123' } })
    expect(res.success).toBe(true)
    expect(mockSendEmbed).not.toHaveBeenCalled()
    expect(mockWriteState).not.toHaveBeenCalled()

    // Scenario 4: Search extraction fails completely (null) -> NO post (null guard)
    mockSearch.mockResolvedValueOnce('League of Legends maintenance schedule and server status.')
    res = await workflowEngine.executeWorkflow(patchWf.id, { bot: {}, channel: { id: 'c123' } })
    expect(res.success).toBe(true)
    expect(mockSendEmbed).not.toHaveBeenCalled()
    expect(mockWriteState).not.toHaveBeenCalled()

    // Scenario 5: Genuine new patch is released (26.19 > 26.18) -> POST and UPDATE baseline!
    mockSearch.mockResolvedValueOnce('## Latest Summary\n**Current Patch: 26.19**\nWorlds 2026 patch is live!')
    res = await workflowEngine.executeWorkflow(patchWf.id, { bot: {}, channel: { id: 'c123' } })
    expect(res.success).toBe(true)
    expect(mockSendEmbed).toHaveBeenCalledTimes(1)
    expect(mockSendEmbed).toHaveBeenCalledWith(expect.objectContaining({
      title: 'New Patch 26.19'
    }))
    expect(mockWriteState).toHaveBeenCalledTimes(1)
    expect(mockWriteState).toHaveBeenCalledWith(expect.objectContaining({
      key: 'lol_patch_baseline',
      value: '26.19'
    }))

    actionExecutor.executeAction.mockRestore()
  })

  test('condition evaluation treats hasChanged as false by default unless explicitly true', () => {
    // 1. condition: 'changed' with non-diff results
    expect(workflowEngine._evaluateCondition('changed', 'regular string output', [], {})).toBe(false)
    expect(workflowEngine._evaluateCondition('changed', { status: 'success' }, [], {})).toBe(false)
    expect(workflowEngine._evaluateCondition('changed', { hasChanged: false }, [], {})).toBe(false)
    expect(workflowEngine._evaluateCondition('changed', { hasChanged: true }, [], {})).toBe(true)

    // 2. Expression with missing or non-boolean hasChanged
    const context = { stepNameToIndex: { step1: 0, step2: 1 } }
    const stepResults = [
      'simple string',
      { exists: true, value: 'current_val' } // no hasChanged property
    ]

    // $steps.step1.output.hasChanged == true should be false
    expect(workflowEngine._evaluateCondition('$steps.step1.output.hasChanged == true', null, stepResults, {}, context)).toBe(false)
    // $steps.step2.output.hasChanged == true should be false
    expect(workflowEngine._evaluateCondition('$steps.step2.output.hasChanged == true', null, stepResults, {}, context)).toBe(false)
    // $steps.step2.output.hasChanged should be false
    expect(workflowEngine._evaluateCondition('$steps.step2.output.hasChanged', null, stepResults, {}, context)).toBe(false)
    // $steps.step2.output.hasChanged == false should be true
    expect(workflowEngine._evaluateCondition('$steps.step2.output.hasChanged == false', null, stepResults, {}, context)).toBe(true)
  })

  test('extractVersionOrPatch strictly excludes future, scheduled, and pbe patch candidates in prefix and suffix', () => {
    const { extractVersionOrPatch } = workflowEngine.constructor

    // Suffix date and scheduling patterns
    expect(extractVersionOrPatch('LoL Patch Notes ⇒ Patch 26.18 Live · 26.19 on Sep 23')).toBe('26.18')
    expect(extractVersionOrPatch('Patch 26.19 is scheduled for September 23, 2026')).toBeNull()
    expect(extractVersionOrPatch('Upcoming Patch 26.19 preview and tentative changes')).toBeNull()
    expect(extractVersionOrPatch('Patch 26.19 PBE notes and datamines')).toBeNull()
    expect(extractVersionOrPatch('League of Legends Patch 26.19 will release on Wednesday')).toBeNull()
    expect(extractVersionOrPatch('Expected release for Patch 26.19 is tomorrow')).toBeNull()
    expect(extractVersionOrPatch('Patch 26.19 (Upcoming)')).toBeNull()
    expect(extractVersionOrPatch('Patch 26.19 (PBE)')).toBeNull()
    expect(extractVersionOrPatch('Patch 26.19 (Tentative)')).toBeNull()
    expect(extractVersionOrPatch('Patch 26.19 in 3 days')).toBeNull()
    expect(extractVersionOrPatch('Patch 26.19 target date is next week')).toBeNull()

    // Valid live patches
    expect(extractVersionOrPatch('League of Legends Patch 26.18 Notes: Champion updates and balance changes')).toBe('26.18')
    expect(extractVersionOrPatch('Patch 26.18 is live on all servers!')).toBe('26.18')
    expect(extractVersionOrPatch('Patch 26.18 Live')).toBe('26.18')
  })

  test('hasMeaningfulPatchNotes validates substantial patch content and rejects stubs/schedules/placeholders', () => {
    const { hasMeaningfulPatchNotes } = workflowEngine.constructor

    // Rejection: Null or empty
    expect(hasMeaningfulPatchNotes(null)).toBe(false)
    expect(hasMeaningfulPatchNotes('')).toBe(false)

    // Rejection: Incomplete prompt stub from local model
    expect(hasMeaningfulPatchNotes('### Patch 26.19 (Latest\n\n[INSTRUCTIONS]: Use this real-time distilled information to formulate your answer.')).toBe(false)

    // Rejection: Schedule snippet without actual notes
    expect(hasMeaningfulPatchNotes('LoL Patch Notes ⇒ Patch 26.18 Live · 26.19 on Sep 23. Check out the release schedule and maintenance times.')).toBe(false)

    // Rejection: Future unreleased notice
    expect(hasMeaningfulPatchNotes('Patch 26.19 is scheduled to release on September 23, 2026. Patch notes have not been released yet by Riot Games. Stay tuned.')).toBe(false)

    // Rejection: Search placeholder / error
    expect(hasMeaningfulPatchNotes('[SYSTEM: WEB RESEARCH FINDINGS FOR query]\nNo direct external web pages or articles were retrieved. Rely on deep internal model reasoning to answer the query thoroughly.')).toBe(false)

    // Rejection: Action executed with no text
    expect(hasMeaningfulPatchNotes('Action executed successfully but returned no text.')).toBe(false)

    // Acceptance: Genuine patch notes summary with champion changes and balance details
    const realSummary = `## League of Legends Patch 26.19 Notes
- Champion Buffs: Ahri Q damage increased to 50, Azir W soldier damage scaling improved.
- Champion Nerfs: Smolder passive stacks reduced, Corki base attack damage decreased.
- Item Changes: Bloodthirster cost increased to 3400 gold with adjusted life steal.`
    expect(hasMeaningfulPatchNotes(realSummary)).toBe(true)

    // Acceptance: Official Riot highlights with balance changes
    const riotHighlights = 'Patch 26.19 Highlights: Worlds 2026 balance adjustments are live! Key champion changes include buffs for K\'Sante and nerfs for Zeri. Several mage items adjusted for mid lane.'
    expect(hasMeaningfulPatchNotes(riotHighlights)).toBe(true)
  })

  test('condition evaluation supports compound expressions with && and ||', () => {
    const context = { stepNameToIndex: { step1: 0, step2: 1 } }
    const stepResults = [
      { hasChanged: true },
      '## Patch 26.19 Notes\nChampion Buffs: Ahri Q damage increased.\nChampion Nerfs: Corki base stats reduced.\nItem updates for mage items.'
    ]

    // Both true with &&
    expect(workflowEngine._evaluateCondition(
      '$steps.step1.hasChanged == true && $steps.step2.hasMeaningfulPatchNotes == true',
      null,
      stepResults,
      {},
      context
    )).toBe(true)

    // First true, second false with &&
    const stepResultsWithStub = [
      { hasChanged: true },
      '### Patch 26.19 (Latest'
    ]
    expect(workflowEngine._evaluateCondition(
      '$steps.step1.hasChanged == true && $steps.step2.hasMeaningfulPatchNotes == true',
      null,
      stepResultsWithStub,
      {},
      context
    )).toBe(false)

    // With ||
    expect(workflowEngine._evaluateCondition(
      '$steps.step1.hasChanged == false || $steps.step2.hasMeaningfulPatchNotes == true',
      null,
      stepResults,
      {},
      context
    )).toBe(true)
  })

  test('lol_patch_checker pipeline strictly blocks embed and state update if notes are not meaningful', async () => {
    stateStore.set('lol_patch_baseline', '26.18')

    const mockSearch = jest.fn()
    const mockSendEmbed = jest.fn()
    const mockWriteState = jest.fn()

    jest.spyOn(actionExecutor, 'executeAction').mockImplementation(async (actionName, bot, channel, params, context) => {
      if (actionName === 'web_search') return mockSearch(params)
      if (actionName === 'read_state') {
        const readState = require('../util/actions/read_state')
        return readState.execute(bot, channel, params, context)
      }
      if (actionName === 'send_embed') return mockSendEmbed(params)
      if (actionName === 'write_state') return mockWriteState(params)
      return 'ok'
    })

    const patchWf = workflowEngine.createWorkflow({
      name: 'lol_patch_checker_strict_test',
      description: 'Strict patch checker test',
      steps: [
        {
          name: 'search_latest_patch',
          action: 'web_search',
          params: { query: 'latest League of Legends patch notes summary' }
        },
        {
          name: 'compare_patch_baseline',
          action: 'read_state',
          params: { key: 'lol_patch_baseline', compare_with: '$steps.search_latest_patch.patch' }
        },
        {
          name: 'post_patch_tldr',
          action: 'send_embed',
          condition: '$steps.compare_patch_baseline.output.hasChanged == true && $steps.search_latest_patch.hasMeaningfulPatchNotes == true',
          params: { title: 'New Patch $steps.search_latest_patch.patch', description: '$steps.search_latest_patch.output' }
        },
        {
          name: 'update_patch_baseline',
          action: 'write_state',
          condition: '$steps.compare_patch_baseline.output.hasChanged == true && $steps.search_latest_patch.hasMeaningfulPatchNotes == true',
          params: { key: 'lol_patch_baseline', value: '$steps.search_latest_patch.patch' }
        }
      ]
    })

    // Scenario A: Higher patch (26.19) detected from a stub, but NO meaningful patch notes -> NO post, NO baseline change
    mockSearch.mockResolvedValueOnce('### Patch 26.19 (Latest\n\n[INSTRUCTIONS]: Use this real-time distilled information to formulate your answer.')
    let res = await workflowEngine.executeWorkflow(patchWf.id, { bot: {}, channel: { id: 'c123' } })
    expect(res.success).toBe(true)
    expect(mockSendEmbed).not.toHaveBeenCalled()
    expect(mockWriteState).not.toHaveBeenCalled()

    // Scenario B: DuckDuckGo search snippet with scheduled future date -> 26.19 rejected as future, 26.18 extracted -> NO post
    mockSearch.mockResolvedValueOnce('LoL Patch Notes ⇒ Patch 26.18 Live · 26.19 on Sep 23')
    res = await workflowEngine.executeWorkflow(patchWf.id, { bot: {}, channel: { id: 'c123' } })
    expect(res.success).toBe(true)
    expect(mockSendEmbed).not.toHaveBeenCalled()
    expect(mockWriteState).not.toHaveBeenCalled()

    // Scenario C: Genuine new patch (26.19) WITH meaningful patch notes -> POST and UPDATE baseline!
    const realPatchContent = `[SYSTEM: WEB SEARCH RESULTS (Distilled Knowledge)]
## League of Legends Patch 26.19 Notes
- Champion Buffs: Ahri Q damage increased from 40 to 50, Azir W soldier damage scaling improved.
- Champion Nerfs: Smolder passive stacks reduced, Corki base attack damage decreased.
- Item Changes: Bloodthirster cost increased to 3400 gold with adjusted balance.

[INSTRUCTIONS]: Use this real-time distilled information to formulate your answer.`

    mockSearch.mockResolvedValueOnce(realPatchContent)
    res = await workflowEngine.executeWorkflow(patchWf.id, { bot: {}, channel: { id: 'c123' } })
    expect(res.success).toBe(true)
    expect(mockSendEmbed).toHaveBeenCalledTimes(1)
    expect(mockSendEmbed).toHaveBeenCalledWith(expect.objectContaining({
      title: 'New Patch 26.19'
    }))
    expect(mockWriteState).toHaveBeenCalledTimes(1)
    expect(mockWriteState).toHaveBeenCalledWith(expect.objectContaining({
      key: 'lol_patch_baseline',
      value: '26.19'
    }))

    actionExecutor.executeAction.mockRestore()
  })
})

