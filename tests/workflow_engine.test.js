const workflowEngine = require('../util/WorkflowEngine')
const actionExecutor = require('../util/ActionExecutor')
const manageWorkflowsAction = require('../util/actions/manage_workflows')

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
})
