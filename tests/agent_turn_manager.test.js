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
    const mockQuery = jest.fn()
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: "The capital of France is Paris."
        }
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: JSON.stringify({ has_pending_work: false })
        }
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
    expect(mockQuery).toHaveBeenCalledTimes(2)
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
    expect(mockQuery).toHaveBeenCalledTimes(3)
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
      // Step 4b: Coordinator evaluation confirming completion
      .mockResolvedValueOnce({
        message: { role: "assistant", content: JSON.stringify({ has_pending_work: false }) }
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
    expect(mockQuery).toHaveBeenCalledTimes(5)
  })

  test("executeTurn detects intermediate commentary without tool call and prompts immediate action", async () => {
    const mockQuery = jest.fn()
      // Step 1: Tool call that returns error
      .mockResolvedValueOnce({
        message: { role: "assistant", content: `<<<RUN_COMMAND: {"command": "read_system_file", "file_path": "nonexistent.json"}>>>` }
      })
      // Step 2: Intermediate commentary without tool call
      .mockResolvedValueOnce({
        message: { role: "assistant", content: "I found an issue with the file structure." }
      })
      // Step 2b: LLM Coordinator reflection evaluating whether work is pending
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: JSON.stringify({
            has_pending_work: true,
            reason: "Tool error occurred and assistant stated an issue without running repair tool",
            suggested_action: "Execute repair tool"
          })
        }
      })
      // Step 3: Actual tool call execution after coordinator prompt
      .mockResolvedValueOnce({
        message: { role: "assistant", content: `<<<RUN_COMMAND: {"command": "get_host_stats"}>>>` }
      })
      // Step 4: Final answer
      .mockResolvedValueOnce({
        message: { role: "assistant", content: "Command completed successfully." }
      })
      // Step 4b: Coordinator evaluation confirming completion
      .mockResolvedValueOnce({
        message: { role: "assistant", content: JSON.stringify({ has_pending_work: false }) }
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
    expect(mockQuery).toHaveBeenCalledTimes(6)
  })

  test("hasPendingWork detects incomplete action task when only read tools executed", () => {
    // Case 1: Code task where only read tool ran
    const pending = turnManager.hasPendingWork({
      ollamaContext: { isCodeTask: true },
      executedTools: [{ name: "list_slash_commands" }],
      assistantText: "I found the command in the list.",
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

    // Case 3: Pure conversation without tools or code task
    const pureConversation = turnManager.hasPendingWork({
      ollamaContext: {},
      executedTools: [],
      assistantText: "Here are some name ideas for the bot.",
      channelHistory: { messages: [] }
    })
    expect(pureConversation).toBe(false)

    // Case 4: Model outputting code block in markdown instead of executing tool on code task
    const codeBlockInChat = turnManager.hasPendingWork({
      ollamaContext: { isCodeTask: true },
      executedTools: [{ name: "list_slash_commands" }],
      assistantText: "Here is the code:\n```javascript\nmodule.exports = { data: new SlashCommandBuilder() }\n```",
      channelHistory: { messages: [] }
    })
    expect(codeBlockInChat).toBe(true)
  })

  test("evaluatePendingWork uses LLM coordinator reflection when text is ambiguous", async () => {
    turnManager.queryOllamaWithContext = jest.fn().mockResolvedValue({
      message: {
        role: "assistant",
        content: JSON.stringify({
          has_pending_work: true,
          reason: "Assistant stated it will research but did not execute web_search tool",
          suggested_action: "Call web_search with query"
        })
      }
    })

    const evalResult = await turnManager.evaluatePendingWork({
      ollamaContext: { isCodeTask: false },
      executedTools: [{ name: "custom_plugin_tool" }],
      assistantText: "The state looks interesting here.",
      channelHistory: {
        messages: [{ role: "user", content: "Can you analyze the logs and take appropriate action?" }]
      }
    })

    expect(evalResult.isPending).toBe(true)
    expect(evalResult.reason).toContain("Assistant stated it will research")
    expect(evalResult.suggestedAction).toContain("Call web_search")
  })

  test("evaluatePendingWork detects insufficient response or leaked command failure and prompts feedback", async () => {
    turnManager.queryOllamaWithContext = jest.fn().mockResolvedValue({
      message: {
        role: "assistant",
        content: JSON.stringify({
          is_sufficient: false,
          reason: "Assistant output raw unexecuted command syntax instead of executing or answering",
          suggested_action: "Execute read_system_file tool with <<<RUN_COMMAND: {...}>>>"
        })
      }
    })

    const evalResult = await turnManager.evaluatePendingWork({
      ollamaContext: {},
      executedTools: [],
      assistantText: "<<<RUN_COMMAND: {\"command\": \"read_system_file\", \"file_path\": \"frontend/src/\"}}>>",
      channelHistory: {
        messages: [{ role: "user", content: "Check frontend/src" }]
      }
    })

    expect(evalResult.isSufficient).toBe(false)
    expect(evalResult.isPending).toBe(true)
    expect(evalResult.reason).toContain("Assistant output raw unexecuted command syntax")
    expect(evalResult.suggestedAction).toContain("Execute read_system_file")
  })

  test("evaluatePendingWork detects mid-turn intent promise without tool execution", async () => {
    turnManager.queryOllamaWithContext = jest.fn().mockResolvedValue({
      message: {
        role: "assistant",
        content: JSON.stringify({
          is_sufficient: false,
          reason: "Assistant stated intent to inspect ChatContainer component CSS but stopped with commentary without executing tool",
          suggested_action: "Execute read_system_file for ChatContainer.module.css"
        })
      }
    })

    const evalResult = await turnManager.evaluatePendingWork({
      ollamaContext: {},
      executedTools: [],
      assistantText: "The issue is a layout error. I need to inspect the CSS. I will start with the ChatContainer component's CSS.",
      channelHistory: {
        messages: [{ role: "user", content: "For the web app on iOS the bottom of the chat has a large gap from the bottom of the screen" }]
      }
    })

    expect(evalResult.isSufficient).toBe(false)
    expect(evalResult.isPending).toBe(true)
    expect(evalResult.reason).toContain("Assistant stated intent to inspect")
    expect(evalResult.suggestedAction).toContain("Execute read_system_file")
  })
})
