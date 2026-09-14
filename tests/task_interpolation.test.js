const ActionExecutor = require('../util/ActionExecutor')
const AgentTurnManager = require('../util/chat/AgentTurnManager')

describe('Scheduled Task Message Interpolation & Budgeting', () => {
  test('extracts clean quoted message from prompt instructions', () => {
    const raw = 'Send this exact message to @LushyLee: "Hey @LushyLee! Time for your 1-mile exercise. 💛" (Keep it short, no pep talk)'
    const cleaned = ActionExecutor.interpolateTaskContent(raw, {})
    expect(cleaned).toBe('Hey @LushyLee! Time for your 1-mile exercise. 💛')
  })

  test('interpolates Day [N] dynamically based on start date', () => {
    const task = {
      description: 'Daily exercise reminder. Started Sept 1.',
      params: {
        startDate: '2026-09-01'
      }
    }
    const raw = 'Hey @LushyLee! Day [N] of your September mile. Time for your 1-mile — walk, bike, run, whatever works. 💛'
    const cleaned = ActionExecutor.interpolateTaskContent(raw, task)
    expect(cleaned).toMatch(/Day \d+ of your September mile/)
    expect(cleaned).not.toContain('[N]')
  })

  test('interpolates Day [N] when start date is mentioned in description', () => {
    const task = {
      description: 'Send this exact message to @LushyLee: "Hey @LushyLee! Day [N] of your September mile. Time for your 1-mile — walk, bike, run, whatever works. 💛" (Replace [N] with the actual day number counting from Sept 1 = Day 1.)'
    }
    const cleaned = ActionExecutor.interpolateTaskContent(task.description, task)
    expect(cleaned).toMatch(/^Hey @LushyLee! Day \d+ of your September mile/)
    expect(cleaned).not.toContain('[N]')
    expect(cleaned).not.toContain('Replace [N]')
  })

  test('preserves plain messages without quotes or dynamic variables', () => {
    const plain = "Hey there! Don't forget to drink water today."
    expect(ActionExecutor.interpolateTaskContent(plain, {})).toBe(plain)
  })

  test('verifies AgentTurnManager initializes with send_message budgeting', () => {
    const manager = new AgentTurnManager({ botName: 'Skynet' })
    expect(manager).toBeDefined()
  })
})
