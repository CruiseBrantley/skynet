const getHostStats = require('../util/actions/get_host_stats')

describe('get_host_stats Action', () => {
  test('executes and returns system diagnostic report with CPU, RAM, and Process info', async () => {
    const res = await getHostStats.execute({}, {}, {})
    expect(typeof res).toBe('string')
    expect(res).toContain('[SYSTEM: Host Diagnostic Report:')
    expect(res).toContain('Processor (CPU):')
    expect(res).toContain('System Memory (RAM):')
    expect(res).toContain('Skynet Bot Process:')
    expect(res).toContain('Load Averages')
    expect(res).toContain('Process RSS Memory')
  })
})
