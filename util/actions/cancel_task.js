const agentScheduler = require('../AgentScheduler')

module.exports = {
  name: 'cancel_task',
  description: 'Cancels a scheduled task by its ID.',
  schema: {
    id: 'The unique ID of the task to be cancelled.'
  },
  execute: async (bot, channel, params, context) => {
    const id = params.id || params.task_id
    if (!id) {
      return '[SYSTEM: Error - No task ID provided.]'
    }

    const success = agentScheduler.cancel(id)
    if (success) {
      return `[SYSTEM: Task ${id} has been cancelled successfully.]`
    } else {
      return `[SYSTEM: No task with ID "${id}" was found. It may have already completed or the ID is incorrect.]`
    }
  }
}
