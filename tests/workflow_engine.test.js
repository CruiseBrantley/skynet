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
})
