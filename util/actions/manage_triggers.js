const triggerEngine = require('../TriggerEngine')

module.exports = {
  name: 'manage_triggers',
  description: 'Creates, lists, enables, disables, deletes, or tests automated reactive watchdog triggers (e.g. auto-heal on 3 consecutive errors, auto-rollback, resource threshold alerts like host_ram, host_cpu).',
  schema: {
    action: {
      type: 'string',
      description: 'Action to perform: "list", "create", "disable", "enable", "delete", or "test".'
    },
    condition_type: {
      type: 'string',
      description: 'Condition type for create/disable: "command_error_streak", "command_error_rate", "host_cpu", "host_ram", "bot_memory".'
    },
    target: {
      type: 'string',
      description: 'Target command name for command triggers (e.g. "netstats", "restart") or null for all commands.'
    },
    threshold: {
      type: 'number',
      description: 'Numeric threshold (e.g. 3 consecutive errors, 50% error rate, 90% RAM, 8.0 CPU load, 750 MB RSS).'
    },
    action_type: {
      type: 'string',
      description: 'Action when tripped: "alert_owner", "auto_heal", "auto_rollback", "auto_restart", or "send_message".'
    },
    cooldown_minutes: {
      type: 'integer',
      description: 'Cooldown in minutes before trigger can fire again (default: 15).'
    },
    trigger_id: {
      type: 'string',
      description: 'Trigger ID or condition name to enable, disable, delete, or test (e.g. "host_ram", "trig_12345").'
    },
    description: {
      type: 'string',
      description: 'Optional human-readable description for the trigger.'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const action = (params.action || 'list').toLowerCase().trim()

    if (action === 'list') {
      const triggers = triggerEngine.listTriggers()
      if (triggers.length === 0) {
        return '[SYSTEM: Watchdog Triggers: No active conditional triggers registered. Use action="create" to add one.]'
      }

      let out = `🛡️ **Reactive Watchdog Triggers (${triggers.length})**:\n`
      for (const t of triggers) {
        const statusIcon = t.enabled !== false ? '🟢 Enabled' : '🔴 Disabled'
        out += `• **[${t.id}]** \`${t.conditionType}\` (Target: \`${t.target || 'system'}\`, Threshold: \`${t.threshold}\`, Status: ${statusIcon})\n`
        out += `   ↳ **Action**: \`${t.actionType}\` | **Cooldown**: ${t.cooldownMinutes}m | **Desc**: *${t.description}*\n`
      }
      return `[SYSTEM: Watchdog Triggers:\n${out}]`
    }

    if (action === 'create') {
      if (!params.condition_type) {
        return '[SYSTEM: Error: "condition_type" is required for create (e.g. "command_error_streak", "command_error_rate", "host_cpu", "host_ram", "bot_memory").]'
      }
      if (params.threshold === undefined || params.threshold === null) {
        return '[SYSTEM: Error: "threshold" is required for create (numeric value).]'
      }

      try {
        const created = triggerEngine.addTrigger({
          conditionType: params.condition_type,
          target: params.target,
          threshold: params.threshold,
          actionType: params.action_type || 'alert_owner',
          actionParams: params.action_params || {},
          cooldownMinutes: params.cooldown_minutes || 15,
          description: params.description
        })

        return `[SYSTEM: Successfully registered reactive trigger "${created.id}"!\n• Condition: \`${created.conditionType}\` (Target: \`${created.target || 'system'}\`, Threshold: \`${created.threshold}\`)\n• Action: \`${created.actionType}\`\n• Cooldown: ${created.cooldownMinutes} minutes\n• Description: ${created.description}]`
      } catch (err) {
        return `[SYSTEM: Failed to create trigger: ${err.message}]`
      }
    }

    if (action === 'disable' || action === 'enable') {
      const identifier = params.trigger_id || params.id || params.condition_type || params.target || params.name
      if (!identifier) return `[SYSTEM: Error: "trigger_id" or "condition_type" is required for ${action}.]`

      const enabled = action === 'enable'
      const updated = triggerEngine.setTriggerEnabled(identifier, enabled)
      if (updated) {
        return `[SYSTEM: Successfully ${enabled ? 'enabled' : 'disabled'} watchdog trigger "${updated.id}" (${updated.description}).]`
      }
      return `[SYSTEM: Error: No matching trigger found for identifier "${identifier}".]`
    }

    if (action === 'delete' || action === 'remove') {
      const identifier = params.trigger_id || params.id || params.condition_type || params.target || params.name
      if (!identifier) return '[SYSTEM: Error: "trigger_id" or "condition_type" is required for delete.]'

      const ok = triggerEngine.deleteTrigger(identifier)
      if (ok) {
        return `[SYSTEM: Successfully deleted trigger matching "${identifier}".]`
      }
      return `[SYSTEM: Error: No matching trigger found for identifier "${identifier}".]`
    }

    if (action === 'test') {
      const identifier = params.trigger_id || params.id || params.condition_type || params.target
      if (!identifier) return '[SYSTEM: Error: "trigger_id" is required for test.]'

      const trigger = triggerEngine.listTriggers().find(t =>
        t.id === identifier ||
        t.conditionType === identifier ||
        t.target === identifier
      )
      if (!trigger) return `[SYSTEM: Error: Trigger "${identifier}" was not found.]`

      try {
        await triggerEngine._dispatchTriggerAction(trigger, { simulated: true, reason: 'Manual Test Invocation' }, bot)
        return `[SYSTEM: Dispatched simulated test execution for trigger "${trigger.id}" (${trigger.actionType}).]`
      } catch (err) {
        return `[SYSTEM: Error testing trigger: ${err.message}]`
      }
    }

    return `[SYSTEM: Unknown manage_triggers action: "${action}". Expected "list", "create", "disable", "enable", "delete", or "test".]`
  }
}
