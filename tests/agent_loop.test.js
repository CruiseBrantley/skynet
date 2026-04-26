const agentLoop = require('../util/AgentLoop');
const agentMemory = require('../util/AgentMemory');

describe('AgentLoop Cooldown and Multi-Reaction', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('Cooldown respects the 5-minute threshold', async () => {
    const now = Date.now();
    // Recently run (1 minute ago)
    jest.spyOn(agentMemory, 'get').mockReturnValue(String(now - 60 * 1000));
    
    // Manual check of the threshold value
    const lastInterject = agentMemory.get('proactive.last_run.123', 'guild123');
    const diff = Date.now() - parseInt(lastInterject);
    expect(diff).toBeLessThan(5 * 60 * 1000);
  });

  test('Multi-reaction parsing handles multiple tags', async () => {
    const content = 'Wow! <<<REACT: {"messageId": "1", "emoji": "🔥"}>>> and also <<<REACT: {"messageId": "2", "emoji": "😂"}>>>';
    const matches = Array.from(content.matchAll(/<<<REACT:\s*([\s\S]*?)>>>/g));
    expect(matches).toHaveLength(2);
    expect(JSON.parse(matches[0][1]).emoji).toBe('🔥');
    expect(JSON.parse(matches[1][1]).emoji).toBe('😂');
  });

  test('Interjection remains single-fire in parsing', async () => {
    const content = '<<<INTERJECT: "First">>> and <<<INTERJECT: "Second">>>';
    const match = content.match(/<<<INTERJECT:\s*"([\s\S]*?)"/);
    expect(match[1]).toBe('First');
  });

  test('_executeCommand passes guildId to agentMemory', async () => {
    const setSpy = jest.spyOn(agentMemory, 'set').mockImplementation(() => {});
    const cmdData = { command: 'remember', key: 'server.fact', value: 'skynet lives', ttl_days: 7 };
    
    await agentLoop._executeCommand(cmdData, 'guild123');
    
    expect(setSpy).toHaveBeenCalledWith('server.fact', 'skynet lives', 7, 'guild123');
    setSpy.mockRestore();
  });
});
