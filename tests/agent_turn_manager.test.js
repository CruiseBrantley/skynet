const AgentTurnManager = require("../util/chat/AgentTurnManager")
const ActionExecutor = require("../util/ActionExecutor")

jest.mock("../logger")
jest.mock("../util/telemetry", () => ({
  trackCommandExecution: jest.fn().mockResolvedValue()
}))

describe("AgentTurnManager - First-Principles ReAct Engine", () => {
  let turnManager
  let mockInteraction
  let mockDatabase

  beforeEach(() => {
    jest.clearAllMocks()
    turnManager = new AgentTurnManager({ botName: "Skynet" })

    mockInteraction = {
      guildId: "guild-123",
      channelId: "chan-456",
      user: { id: "user-789", tag: "user#0001", username: "user" },
      member: { id: "user-789", nickname: "UserNick" },
      client: {
        user: { id: "bot-000" },
        commands: new Map()
      },
      channel: {
        id: "chan-456",
        send: jest.fn().mockResolvedValue({})
      },
      deferReply: jest.fn().mockResolvedValue({}),
      editReply: jest.fn().mockResolvedValue({}),
      followUp: jest.fn().mockResolvedValue({}),
      deleteReply: jest.fn().mockResolvedValue({})
    }

    mockDatabase = {}
  })

  test("getToolCatalogPrompt returns structured schema for registered actions", () => {
    const catalog = AgentTurnManager.getToolCatalogPrompt()
    expect(catalog).toContain("### TOOL-USE PROTOCOL & REGISTERED TOOLS ###")
    expect(catalog).toContain("read_state")
    expect(catalog).toContain("get_host_stats")
  })

  test("extractToolCalls parses multiple formats cleanly", () => {
    // Format 1: tool_calls JSON
    const res1 = turnManager.extractToolCalls(`{
  "tool_calls": [
    {"name": "read_state", "arguments": {"key": "test_key"}}
  ]
}`)
    expect(res1).toHaveLength(1)
    expect(res1[0].name).toBe("read_state")
    expect(res1[0].arguments.key).toBe("test_key")

    // Format 2: RUN_COMMAND tag
    const res2 = turnManager.extractToolCalls(`I will check that. <<<RUN_COMMAND: {"command": "get_host_stats"}>>>`)
    expect(res2).toHaveLength(1)
    expect(res2[0].name).toBe("get_host_stats")

    // Format 3: XML tool_call
    const res3 = turnManager.extractToolCalls(`<tool_call>{"name": "fetch_feed", "arguments": {"url": "https://example.com"}}</tool_call>`)
    expect(res3).toHaveLength(1)
    expect(res3[0].name).toBe("fetch_feed")
    expect(res3[0].arguments.url).toBe("https://example.com")

    // Format 4: Pure conversational (no tools)
    const res4 = turnManager.extractToolCalls("Hello! How can I assist you today?")
    expect(res4).toHaveLength(0)
  })

  test("executeTurn handles pure conversational response without tool calls", async () => {
    const mockQuery = jest.fn().mockResolvedValue({
      message: { role: "assistant", content: "The capital of France is Paris." }
    })

    turnManager.queryOllamaWithContext = mockQuery

    const channelHistory = {
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "What is the capital of France?" }
      ]
    }

    const result = await turnManager.executeTurn({
      interaction: mockInteraction,
      database: mockDatabase,
      channelHistory,
      ollamaContext: {}
    })

    expect(result.success).toBe(true)
    expect(result.replyContent).toBe("The capital of France is Paris.")
    expect(result.executedTools).toHaveLength(0)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  test("executeTurn handles multi-step tool call execution and observation feedback", async () => {
    const mockQuery = jest.fn()
      // Step 1: Model calls read_state tool
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: `{"tool_calls": [{"name": "read_state", "arguments": {"key": "d4_patch"}}]}`
        }
      })
      // Step 2: Model ingests observation and provides final answer
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: "The latest Diablo 4 patch is version 2.1.0."
        }
      })

    turnManager.queryOllamaWithContext = mockQuery

    const channelHistory = {
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "What is the current D4 patch in state?" }
      ]
    }

    const result = await turnManager.executeTurn({
      interaction: mockInteraction,
      database: mockDatabase,
      channelHistory,
      ollamaContext: {}
    })

    expect(result.success).toBe(true)
    expect(result.replyContent).toBe("The latest Diablo 4 patch is version 2.1.0.")
    expect(result.executedTools).toHaveLength(1)
    expect(result.executedTools[0].name).toBe("read_state")
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  test("executeTurn detects cycle on 3 consecutive identical tool calls and injects warning", async () => {
    const mockQuery = jest.fn()
      // Step 1, 2, 3: Same tool call
      .mockResolvedValueOnce({
        message: { role: "assistant", content: `<<<RUN_COMMAND: {"command": "get_host_stats"}>>>` }
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: `<<<RUN_COMMAND: {"command": "get_host_stats"}>>>` }
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: `<<<RUN_COMMAND: {"command": "get_host_stats"}>>>` }
      })
      // Step 4: Final resolution
      .mockResolvedValueOnce({
        message: { role: "assistant", content: "System metrics retrieved." }
      })

    turnManager.queryOllamaWithContext = mockQuery

    const channelHistory = {
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Check stats" }
      ]
    }

    const result = await turnManager.executeTurn({
      interaction: mockInteraction,
      database: mockDatabase,
      channelHistory,
      ollamaContext: {}
    })

    expect(result.success).toBe(true)
    expect(result.replyContent).toBe("System metrics retrieved.")
    expect(mockQuery).toHaveBeenCalledTimes(4)
  })

  test("executeTurn detects intermediate commentary without tool call and prompts immediate action", async () => {
    const mockQuery = jest.fn()
      // Step 1: Tool call that returns error
      .mockResolvedValueOnce({
        message: { role: "assistant", content: `<<<RUN_COMMAND: {"command": "read_system_file", "file_path": "nonexistent.json"}>>>` }
      })
      // Step 2: Intermediate commentary ("Fixing the structure now.") without tool call
      .mockResolvedValueOnce({
        message: { role: "assistant", content: "Fixing the structure now." }
      })
      // Step 3: Actual tool call execution
      .mockResolvedValueOnce({
        message: { role: "assistant", content: `<<<RUN_COMMAND: {"command": "get_host_stats"}>>>` }
      })
      // Step 4: Final answer
      .mockResolvedValueOnce({
        message: { role: "assistant", content: "Command completed successfully." }
      })

    turnManager.queryOllamaWithContext = mockQuery

    const channelHistory = {
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Run task" }
      ]
    }

    const result = await turnManager.executeTurn({
      interaction: mockInteraction,
      database: mockDatabase,
      channelHistory,
      ollamaContext: {}
    })

    expect(result.success).toBe(true)
    expect(result.replyContent).toBe("Command completed successfully.")
    expect(mockQuery).toHaveBeenCalledTimes(4)
  })

  test("hasPendingWork detects incomplete action task when only read tools executed", () => {
    // Case 1: Code task where only read tool ran
    const pending = turnManager.hasPendingWork({
      ollamaContext: { isCodeTask: true },
      executedTools: [{ name: "list_slash_commands" }],
      assistantText: "I found the command in the list and it needs to be updated.",
      channelHistory: { messages: [] }
    })
    expect(pending).toBe(true)

    // Case 2: Code task where mutation tool ran
    const finished = turnManager.hasPendingWork({
      ollamaContext: { isCodeTask: true },
      executedTools: [{ name: "create_slash_command" }],
      assistantText: "Successfully created and deployed /soundboard.",
      channelHistory: { messages: [] }
    })
    expect(finished).toBe(false)

    // Case 4: False ending stating rewriting to match working pattern without calling tool
    const falseEndingRewrite = turnManager.hasPendingWork({
      ollamaContext: { isCodeTask: true },
      executedTools: [{ name: "inspect_slash_command" }],
      assistantText: "Rewriting to match the working pattern exactly.",
      channelHistory: { messages: [] }
    })
    expect(falseEndingRewrite).toBe(true)

    // Case 5: Model outputting code block in markdown instead of executing tool on code task
    const codeBlockInChat = turnManager.hasPendingWork({
      ollamaContext: { isCodeTask: true },
      executedTools: [{ name: "list_slash_commands" }],
      assistantText: "Here is the code:\n```javascript\nmodule.exports = { data: new SlashCommandBuilder() }\n```",
      channelHistory: { messages: [] }
    })
    expect(codeBlockInChat).toBe(true)

    // Case 6: Structural forward-intent "let me find usable sources"
    const structuralForwardIntent = turnManager.hasPendingWork({
      ollamaContext: {},
      executedTools: [],
      assistantText: "Let me find usable sources for that topic.",
      channelHistory: { messages: [] }
    })
    expect(structuralForwardIntent).toBe(true)
  })
})
