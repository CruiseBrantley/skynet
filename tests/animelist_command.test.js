const animelistCommand = require("../commands/animelist")
const malClient = require("../util/malClient")
const ActionExecutor = require("../util/ActionExecutor")

jest.mock("../util/malClient")
jest.mock("../util/ActionExecutor")
jest.mock("../logger")

describe("Slash Command: /animelist", () => {
  let mockInteraction
  const OWNER_ID = "199749017150816256"

  beforeAll(() => {
    process.env.OWNER_ID = OWNER_ID
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockInteraction = {
      user: { id: OWNER_ID, username: "sirian" },
      guildId: "525112230006489091",
      options: {
        getSubcommand: jest.fn(),
        getString: jest.fn(),
        getInteger: jest.fn(),
        getBoolean: jest.fn()
      },
      reply: jest.fn().mockResolvedValue({}),
      deferReply: jest.fn().mockResolvedValue({}),
      editReply: jest.fn().mockResolvedValue({})
    }
  })

  test("command definition includes all subcommands", () => {
    const json = animelistCommand.data.toJSON()
    expect(json.name).toBe("animelist")
    const subNames = json.options.map(o => o.name)
    expect(subNames).toContain("add")
    expect(subNames).toContain("remove")
    expect(subNames).toContain("list")
    expect(subNames).toContain("sync")
    expect(subNames).toContain("auth")
  })

  test("auth subcommand rejects non-owner", async () => {
    mockInteraction.user.id = "not_the_owner"
    mockInteraction.options.getSubcommand.mockReturnValue("auth")

    await animelistCommand.execute(mockInteraction)
    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      ephemeral: true,
      content: expect.stringContaining("Only the bot owner")
    }))
  })

  test("auth subcommand generates auth link for owner", async () => {
    mockInteraction.options.getSubcommand.mockReturnValue("auth")
    malClient.getAuthUrl.mockReturnValue("https://myanimelist.net/oauth/mock")

    await animelistCommand.execute(mockInteraction)
    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      ephemeral: true,
      embeds: expect.any(Array)
    }))
  })

  test("add subcommand adds anime to MAL and schedules calendar", async () => {
    mockInteraction.options.getSubcommand.mockReturnValue("add")
    mockInteraction.options.getString.mockImplementation((name) => {
      if (name === "title") return "Solo Leveling S2"
      if (name === "platform") return "Crunchyroll"
      return null
    })
    mockInteraction.options.getInteger.mockReturnValue(12)
    mockInteraction.options.getBoolean.mockReturnValue(true)

    malClient.searchAnime.mockResolvedValue({
      id: 56789,
      title: "Solo Leveling: Arise from the Shadow",
      coverImage: "https://example.com/cover.jpg",
      episodes: 12
    })
    malClient.isAuthenticated.mockReturnValue(true)
    malClient.addAnime.mockResolvedValue({ success: true })
    malClient.getPublicUrl.mockReturnValue("https://myanimelist.net/animelist/skynetanimelist")

    ActionExecutor.executeAction.mockResolvedValue({ success: true })

    await animelistCommand.execute(mockInteraction)
    expect(mockInteraction.deferReply).toHaveBeenCalled()
    expect(malClient.addAnime).toHaveBeenCalledWith(56789, { status: "watching" })
    expect(ActionExecutor.executeAction).toHaveBeenCalledWith(
      "google_calendar",
      expect.objectContaining({
        operation: "create_event",
        summary: "Solo Leveling: Arise from the Shadow",
        streaming_service: "Crunchyroll"
      }),
      expect.anything()
    )
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }))
  })

  test("remove subcommand removes anime from MAL and calendar", async () => {
    mockInteraction.options.getSubcommand.mockReturnValue("remove")
    mockInteraction.options.getString.mockReturnValue("Solo Leveling")
    mockInteraction.options.getBoolean.mockReturnValue(true)

    malClient.isAuthenticated.mockReturnValue(true)
    malClient.removeAnime.mockResolvedValue({ success: true })
    ActionExecutor.executeAction.mockResolvedValue({ success: true })

    await animelistCommand.execute(mockInteraction)
    expect(mockInteraction.deferReply).toHaveBeenCalled()
    expect(malClient.removeAnime).toHaveBeenCalledWith("Solo Leveling")
    expect(ActionExecutor.executeAction).toHaveBeenCalledWith(
      "google_calendar",
      expect.objectContaining({
        operation: "delete_event",
        query: "Solo Leveling"
      }),
      expect.anything()
    )
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }))
  })

  test("list subcommand retrieves user list from MAL", async () => {
    mockInteraction.options.getSubcommand.mockReturnValue("list")
    mockInteraction.options.getString.mockReturnValue("watching")
    malClient.getUserList.mockResolvedValue([
      { anime_id: 101, anime_title: "Frieren", anime_num_episodes: 28, episodes_watched: 10 }
    ])
    malClient.getPublicUrl.mockReturnValue("https://myanimelist.net/animelist/skynetanimelist")

    await animelistCommand.execute(mockInteraction)
    expect(mockInteraction.deferReply).toHaveBeenCalled()
    expect(malClient.getUserList).toHaveBeenCalledWith("watching")
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }))
  })

  test("add subcommand blocks non-owner in unauthorized channel", async () => {
    mockInteraction.user.id = "non_owner_123"
    mockInteraction.channelId = "9999999999"
    mockInteraction.channel = { id: "9999999999" }
    mockInteraction.options.getSubcommand.mockReturnValue("add")
    mockInteraction.options.getString.mockReturnValue("Test Anime")

    await animelistCommand.execute(mockInteraction)
    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      ephemeral: true,
      content: expect.stringContaining("1062784669034229780")
    }))
    expect(mockInteraction.deferReply).not.toHaveBeenCalled()
  })

  test("add subcommand allows non-owner in authorized channel 1062784669034229780", async () => {
    mockInteraction.user.id = "non_owner_123"
    mockInteraction.channelId = "1062784669034229780"
    mockInteraction.channel = { id: "1062784669034229780" }
    mockInteraction.options.getSubcommand.mockReturnValue("add")
    mockInteraction.options.getString.mockImplementation((name) => {
      if (name === "title") return "Solo Leveling S2"
      return null
    })
    mockInteraction.options.getInteger.mockReturnValue(12)
    mockInteraction.options.getBoolean.mockReturnValue(false)

    malClient.searchAnime.mockResolvedValue({ id: 56789, title: "Solo Leveling", episodes: 12 })
    malClient.isAuthenticated.mockReturnValue(true)
    malClient.addAnime.mockResolvedValue({ success: true })
    malClient.getPublicUrl.mockReturnValue("https://myanimelist.net/animelist/skynetanimelist")

    await animelistCommand.execute(mockInteraction)
    expect(mockInteraction.deferReply).toHaveBeenCalled()
    expect(malClient.addAnime).toHaveBeenCalledWith(56789, { status: "watching" })
  })

  test("remove subcommand blocks non-owner in unauthorized channel", async () => {
    mockInteraction.user.id = "non_owner_123"
    mockInteraction.channelId = "9999999999"
    mockInteraction.channel = { id: "9999999999" }
    mockInteraction.options.getSubcommand.mockReturnValue("remove")
    mockInteraction.options.getString.mockReturnValue("Test Anime")

    await animelistCommand.execute(mockInteraction)
    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      ephemeral: true,
      content: expect.stringContaining("1062784669034229780")
    }))
    expect(mockInteraction.deferReply).not.toHaveBeenCalled()
  })

  test("list subcommand allows non-owner in any channel", async () => {
    mockInteraction.user.id = "non_owner_123"
    mockInteraction.channelId = "general_channel"
    mockInteraction.channel = { id: "general_channel" }
    mockInteraction.options.getSubcommand.mockReturnValue("list")
    mockInteraction.options.getString.mockReturnValue("watching")
    malClient.getUserList.mockResolvedValue([
      { anime_id: 101, anime_title: "Frieren", anime_num_episodes: 28, episodes_watched: 10 }
    ])
    malClient.getPublicUrl.mockReturnValue("https://myanimelist.net/animelist/skynetanimelist")

    await animelistCommand.execute(mockInteraction)
    expect(mockInteraction.deferReply).toHaveBeenCalled()
    expect(malClient.getUserList).toHaveBeenCalledWith("watching")
  })

  test("command definition is scoped to guild 525112230006489091", () => {
    expect(animelistCommand.guildId).toBe("525112230006489091")
  })

  test("sync subcommand executes sync and renders structured embed", async () => {
    mockInteraction.options.getSubcommand.mockReturnValue("sync")
    ActionExecutor.executeAction.mockResolvedValueOnce({
      success: true,
      output: {
        username: "skynetanimelist",
        calendarTarget: "Anime Release",
        totalEvaluated: 2,
        alreadyPresent: [{ title: "BLEACH", rawTitle: "Bleach", malId: 60636 }],
        addedToCalendar: [],
        scheduleShifted: [],
        endedTruncated: [],
        errors: []
      }
    })
    malClient.getPublicUrl.mockReturnValue("https://myanimelist.net/animelist/skynetanimelist")

    await animelistCommand.execute(mockInteraction)
    expect(mockInteraction.deferReply).toHaveBeenCalled()
    expect(ActionExecutor.executeAction).toHaveBeenCalledWith(
      "anime_sync",
      expect.objectContaining({ operation: "sync_watchlist", structured: true }),
      expect.anything()
    )
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }))
  })

  test("add subcommand updates existing calendar event instead of creating duplicate", async () => {
    mockInteraction.options.getSubcommand.mockReturnValue("add")
    mockInteraction.options.getString.mockImplementation((name) => {
      if (name === "title") return "Appraisal Skill S3"
      return null
    })
    mockInteraction.options.getBoolean.mockReturnValue(true)

    malClient.searchAnime.mockResolvedValue({
      id: 60601,
      title: "As a Reincarnated Aristocrat, I'll Use My Appraisal Skill to Rise in the World Season 3",
      episodes: 12
    })
    malClient.isAuthenticated.mockReturnValue(true)
    malClient.addAnime.mockResolvedValue({ success: true })
    malClient.getPublicUrl.mockReturnValue("https://myanimelist.net/animelist/skynetanimelist")

    const googleCalendar = require("../util/actions/google_calendar")
    jest.spyOn(googleCalendar, "findExistingEvent").mockResolvedValueOnce({
      id: "existing_cal_123",
      summary: "As a Reincarnated Aristocrat, I'll Use My Appraisal Skill to Rise in the World Season 3"
    })
    jest.spyOn(googleCalendar, "resolveCalendar").mockResolvedValueOnce({ id: "anime_cal_id", summary: "Anime Release" })

    ActionExecutor.executeAction.mockResolvedValue({ success: true })

    await animelistCommand.execute(mockInteraction)
    expect(ActionExecutor.executeAction).toHaveBeenCalledWith(
      "google_calendar",
      expect.objectContaining({
        operation: "update_event",
        event_id: "existing_cal_123",
        summary: "As a Reincarnated Aristocrat, I'll Use My Appraisal Skill to Rise in the World Season 3"
      }),
      expect.anything()
    )
  })
})