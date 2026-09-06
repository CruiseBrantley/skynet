const conversationStore = require("../core/conversationStore")
const path = require("path")

describe("core/conversationStore", () => {
  const testProfile = "test_profile_unit"

  beforeEach(() => {
    conversationStore.clearHistory(testProfile)
  })

  afterAll(() => {
    conversationStore.clearHistory(testProfile)
  })

  test("appends and retrieves messages in chronological order", () => {
    conversationStore.appendMessage(testProfile, {
      role: "user",
      content: "Hello from CLI",
      author: "Sirian",
      source: "cli",
      timestamp: 1000
    })

    conversationStore.appendMessage(testProfile, {
      role: "assistant",
      content: "Hello Sirian!",
      author: "Skynet",
      source: "local",
      timestamp: 2000
    })

    const history = conversationStore.getHistory(testProfile, 10)
    expect(history).toHaveLength(2)
    expect(history[0].content).toBe("Hello from CLI")
    expect(history[0].source).toBe("cli")
    expect(history[1].content).toBe("Hello Sirian!")
  })

  test("deduplicates messages by discordId", () => {
    conversationStore.appendMessage(testProfile, {
      role: "user",
      content: "Discord message 1",
      author: "Sirian",
      source: "discord",
      discordId: "disc_123"
    })

    const duplicate = conversationStore.appendMessage(testProfile, {
      role: "user",
      content: "Discord message 1 duplicate",
      author: "Sirian",
      source: "discord",
      discordId: "disc_123"
    })

    expect(duplicate).toBeNull()
    const history = conversationStore.getHistory(testProfile, 10)
    expect(history).toHaveLength(1)
  })

  test("retrieves the latest Discord snowflake ID for after: queries", () => {
    conversationStore.appendMessage(testProfile, {
      role: "user",
      content: "Msg 1",
      discordId: "1001"
    })
    conversationStore.appendMessage(testProfile, {
      role: "assistant",
      content: "Msg 2 (local CLI)"
    })
    conversationStore.appendMessage(testProfile, {
      role: "user",
      content: "Msg 3",
      discordId: "1003"
    })

    expect(conversationStore.getLatestDiscordMessageId(testProfile)).toBe("1003")
  })

  test("syncFromDiscord fetches only after latest known snowflake ID", async () => {
    conversationStore.appendMessage(testProfile, {
      role: "user",
      content: "Old message",
      discordId: "1000"
    })

    const mockChannel = {
      messages: {
        fetch: jest.fn().mockResolvedValue(new Map([
          ["1005", { id: "1005", content: "New phone message", createdTimestamp: 5000, author: { id: "user1", username: "Sirian" } }]
        ]))
      }
    }

    const newMsgs = await conversationStore.syncFromDiscord(testProfile, mockChannel, "bot_id", 20)
    expect(mockChannel.messages.fetch).toHaveBeenCalledWith({ limit: 20, after: "1000" })
    expect(newMsgs).toHaveLength(1)
    expect(newMsgs[0].content).toBe("New phone message")

    const fullHistory = conversationStore.getHistory(testProfile, 10)
    expect(fullHistory).toHaveLength(2)
  })
})
