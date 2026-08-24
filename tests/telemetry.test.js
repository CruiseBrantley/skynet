const telemetry = require('../util/telemetry')
const getCommandStatsAction = require('../util/actions/get_command_stats')

jest.mock('../logger')

describe('TelemetryEngine and get_command_stats Action', () => {
  beforeEach(() => {
    telemetry.events = []
  })

  test('records slash and autonomous command executions', async () => {
    await telemetry.trackCommandExecution({
      commandName: 'roll',
      type: 'slash',
      guildId: 'guild-123',
      guildName: 'Gaming Guild',
      channelId: 'chan-1',
      userId: 'user-1',
      username: 'Alice',
      success: true,
      durationMs: 45
    })

    await telemetry.trackCommandExecution({
      commandName: 'netstats',
      type: 'autonomous',
      guildId: 'DM',
      guildName: 'Direct Message',
      channelId: 'dm-1',
      userId: 'user-2',
      username: 'Bob',
      success: false,
      error: new Error('Cannot read properties of undefined'),
      durationMs: 120
    })

    expect(telemetry.events.length).toBe(2)
    expect(telemetry.events[0].commandName).toBe('roll')
    expect(telemetry.events[0].success).toBe(true)
    expect(telemetry.events[1].commandName).toBe('netstats')
    expect(telemetry.events[1].success).toBe(false)
    expect(telemetry.events[1].error).toContain('Cannot read properties')
  })

  test('getStats calculates correct aggregate metrics and breakdowns', async () => {
    // Add multiple events
    await telemetry.trackCommandExecution({ commandName: 'roll', guildId: 'g1', userId: 'u1', username: 'Alice', success: true })
    await telemetry.trackCommandExecution({ commandName: 'roll', guildId: 'g1', userId: 'u2', username: 'Bob', success: true })
    await telemetry.trackCommandExecution({ commandName: 'chat', guildId: 'g2', userId: 'u1', username: 'Alice', success: true })
    await telemetry.trackCommandExecution({ commandName: 'netstats', guildId: 'DM', userId: 'u3', username: 'Charlie', success: false, error: 'Fail' })

    const stats = telemetry.getStats({ timeframeHours: 24 })
    expect(stats.totalInvocations).toBe(4)
    expect(stats.successCount).toBe(3)
    expect(stats.errorCount).toBe(1)
    expect(stats.errorRate).toBe('25.0%')

    expect(stats.topCommands[0]).toEqual({ name: 'roll', count: 2 })
    expect(stats.topUsers.find(u => u.username === 'Alice').count).toBe(2)
    expect(stats.recentErrors.length).toBe(1)
    expect(stats.recentErrors[0].command).toBe('netstats')
  })

  test('filters getStats by timeframe and guild', async () => {
    const oldDate = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
    telemetry.events.push({
      id: 'tel_old',
      commandName: 'oldcmd',
      type: 'slash',
      guildId: 'g1',
      guildName: 'G1',
      userId: 'u1',
      username: 'Alice',
      success: true,
      timestamp: oldDate,
      epoch: Date.now() - 48 * 3600 * 1000
    })

    await telemetry.trackCommandExecution({ commandName: 'newcmd', guildId: 'g1', success: true })
    await telemetry.trackCommandExecution({ commandName: 'otherguild', guildId: 'g2', success: true })

    const last24h = telemetry.getStats({ timeframeHours: 24 })
    expect(last24h.totalInvocations).toBe(2)

    const guild1Stats = telemetry.getStats({ timeframeHours: 72, guildId: 'g1' })
    expect(guild1Stats.totalInvocations).toBe(2)
    expect(guild1Stats.topCommands.map(c => c.name)).toContain('oldcmd')
    expect(guild1Stats.topCommands.map(c => c.name)).toContain('newcmd')
  })

  test('get_command_stats dynamic action executes and formats stats', async () => {
    await telemetry.trackCommandExecution({ commandName: 'roll', guildId: 'g1', userId: 'u1', username: 'Alice', success: true })
    await telemetry.trackCommandExecution({ commandName: 'twitch-list', guildId: 'g1', userId: 'u1', username: 'Alice', success: true })

    const result = await getCommandStatsAction.execute(null, null, { timeframe_hours: 168 }, {})
    expect(result).toContain('[SYSTEM: Telemetry Stats Retrieved:')
    expect(result).toContain('Total Invocations')
    expect(result).toContain('roll')
    expect(result).toContain('twitch-list')
  })
})
