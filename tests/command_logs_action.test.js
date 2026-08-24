const telemetry = require('../util/telemetry')
const getCommandLogsAction = require('../util/actions/get_command_logs')

describe('get_command_logs Action and Telemetry Feeds', () => {
  beforeEach(() => {
    telemetry.events = [
      {
        id: 't1',
        commandName: 'roll',
        type: 'slash',
        guildId: 'g1',
        guildName: 'Guild Alpha',
        userId: 'u1',
        username: 'Alice',
        success: true,
        error: null,
        durationMs: 120,
        timestamp: '2026-08-24T03:00:00.000Z',
        epoch: 1787540400000
      },
      {
        id: 't2',
        commandName: 'netstats',
        type: 'slash',
        guildId: 'g1',
        guildName: 'Guild Alpha',
        userId: 'u2',
        username: 'Bob',
        success: false,
        error: 'TypeError: Cannot read properties of undefined',
        durationMs: 450,
        timestamp: '2026-08-24T03:05:00.000Z',
        epoch: 1787540700000
      },
      {
        id: 't3',
        commandName: 'restart',
        type: 'slash',
        guildId: 'DM',
        guildName: 'Direct Message',
        userId: 'u1',
        username: 'Alice',
        success: true,
        error: null,
        durationMs: 250,
        timestamp: '2026-08-24T03:10:00.000Z',
        epoch: 1787541000000
      }
    ]
  })

  test('getRecentLogs returns filtered reverse chronological events', () => {
    const all = telemetry.getRecentLogs({ limit: 10 })
    expect(all.length).toBe(3)
    expect(all[0].commandName).toBe('restart') // Newest first

    const errorsOnly = telemetry.getRecentLogs({ status: 'error' })
    expect(errorsOnly.length).toBe(1)
    expect(errorsOnly[0].commandName).toBe('netstats')
    expect(errorsOnly[0].error).toContain('TypeError')

    const specificCmd = telemetry.getRecentLogs({ commandName: 'roll' })
    expect(specificCmd.length).toBe(1)
    expect(specificCmd[0].commandName).toBe('roll')
  })

  test('formatRecentLogsSummary formats log entries clearly', () => {
    const logs = telemetry.getRecentLogs({ limit: 10 })
    const summary = telemetry.formatRecentLogsSummary(logs)
    expect(summary).toContain('Recent Command Execution Feed')
    expect(summary).toContain('`/restart`')
    expect(summary).toContain('`/netstats`')
    expect(summary).toContain('TypeError')
  })

  test('get_command_logs action executes and returns system prompt wrapper', async () => {
    const output = await getCommandLogsAction.execute({}, {}, { limit: 5, status: 'all' })
    expect(typeof output).toBe('string')
    expect(output).toContain('[SYSTEM: Recent Command Logs Feed:')
    expect(output).toContain('/restart')
    expect(output).toContain('/netstats')
  })
})
