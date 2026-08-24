const workflowEngine = require('../WorkflowEngine')

module.exports = {
  name: 'manage_workflows',
  description: 'Creates, lists, runs, or deletes multi-step autonomous tool pipelines (e.g. search -> diff baseline -> send embed -> update state).',
  schema: {
    action: {
      type: 'string',
      description: 'Action to perform: "list", "create", "run", or "delete".'
    },
    name: {
      type: 'string',
      description: 'Workflow name or identifier.'
    },
    description: {
      type: 'string',
      description: 'Description of what the workflow does.'
    },
    channel_id: {
      type: 'string',
      description: 'Target Discord channel ID for workflow message/embed outputs.'
    },
    steps: {
      type: 'array',
      description: 'Array of step objects. Each step has { name, action, params, condition }.'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const action = (params.action || 'list').toLowerCase().trim()

    if (action === 'list') {
      const list = workflowEngine.listWorkflows()
      if (list.length === 0) {
        return '[SYSTEM: No multi-step workflows registered. Use action="create" to define a tool pipeline.]'
      }

      let out = `⚡ **Registered Autonomous Workflows (${list.length})**:\n`
      for (const w of list) {
        out += `• **[${w.name}]** (${w.id}) — ${w.steps.length} steps\n`
        out += `   ↳ **Desc**: *${w.description}* | **Last Run**: ${w.lastRunAt ? `${w.lastRunAt} (${w.lastRunStatus})` : 'Never'}\n`
      }
      return `[SYSTEM: Autonomous Workflows:\n${out}]`
    }

    if (action === 'create') {
      if (!params.name) return '[SYSTEM: Error: "name" is required for create.]'
      if (!Array.isArray(params.steps) || params.steps.length === 0) {
        return '[SYSTEM: Error: "steps" array with at least one action step is required.]'
      }

      try {
        const wf = workflowEngine.createWorkflow({
          name: params.name,
          description: params.description,
          channelId: params.channel_id || channel?.id,
          guildId: context?.guildId || channel?.guild?.id,
          steps: params.steps
        })

        return `[SYSTEM: Successfully created multi-step workflow "${wf.name}" (${wf.id}) with ${wf.steps.length} steps!\nUse <<<RUN_COMMAND: {"command": "manage_workflows", "action": "run", "name": "${wf.name}"}>>> to test or execute it.]`
      } catch (err) {
        return `[SYSTEM: Failed to create workflow: ${err.message}]`
      }
    }

    if (action === 'run') {
      const name = params.name || params.id
      if (!name) return '[SYSTEM: Error: "name" is required to run a workflow.]'

      try {
        const res = await workflowEngine.executeWorkflow(name, { bot, channel, extraContext: context })
        if (res.success) {
          return `[SYSTEM: Workflow "${res.workflowName}" executed successfully!\nExecution Trace:\n${res.executionLogs.join('\n')}]`
        }
        return `[SYSTEM: Workflow "${name}" failed at step ${res.stepIndex} (${res.stepName}): ${res.error}\nExecution Trace:\n${res.executionLogs.join('\n')}]`
      } catch (err) {
        return `[SYSTEM: Error executing workflow: ${err.message}]`
      }
    }

    if (action === 'delete') {
      const name = params.name || params.id
      if (!name) return '[SYSTEM: Error: "name" is required for delete.]'

      const ok = workflowEngine.deleteWorkflow(name)
      if (ok) return `[SYSTEM: Successfully deleted workflow "${name}".]`
      return `[SYSTEM: Workflow "${name}" was not found.]`
    }

    return `[SYSTEM: Unknown manage_workflows action: "${action}". Expected "list", "create", "run", or "delete".]`
  }
}
