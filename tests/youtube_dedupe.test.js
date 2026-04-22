jest.mock("../util/ollama", () => ({
  queryOllama: jest.fn().mockResolvedValue({ response: "Test Suggestion" }),
}));

const youtube = require("../util/YouTubeMetadata");

describe("YouTube Deduplication", () => {
  let searchSpy;
  let infoSpy;

  const history = [
    { title: "Never Gonna Give You Up", channel: "Rick Astley" },
    { title: "Blinding Lights", channel: "The Weeknd" },
  ];

  beforeEach(() => {
    // Mock search to return specific results
    searchSpy = jest.spyOn(youtube, "search");
    infoSpy = jest.spyOn(youtube, "getVideoInfo");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Identifies exact title matches as duplicates", async () => {
    searchSpy.mockResolvedValue([
      {
        title: "Never Gonna Give You Up",
        url: "https://youtube.com/watch?v=dQw12345678",
      },
    ]);
    // history contains this exact title
    const recs = await youtube.getRecommendation(history);
    expect(recs).toHaveLength(0);
  });

  test('Identifies "Lyrics" version of history track as duplicate', async () => {
    searchSpy.mockResolvedValue([
      {
        title: "Never Gonna Give You Up (Lyrics)",
        url: "https://youtube.com/watch?v=lyrics12345",
      },
    ]);
    const recs = await youtube.getRecommendation(history);
    expect(recs).toHaveLength(0);
  });

  test('Identifies "Official Video" variant as duplicate', async () => {
    searchSpy.mockResolvedValue([
      {
        title: "The Weeknd - Blinding Lights (Official Video)",
        url: "https://youtube.com/watch?v=official123",
      },
    ]);
    const recs = await youtube.getRecommendation(history);
    expect(recs).toHaveLength(0);
  });

  test("Allows a completely different song", async () => {
    const target = {
      title: "Starboy",
      channel: "The Weeknd",
      url: "https://youtube.com/watch?v=starboy1234",
    };
    searchSpy.mockResolvedValue([target]);
    infoSpy.mockResolvedValue({ title: "Starboy" });

    const recs = await youtube.getRecommendation(history);
    expect(recs).toHaveLength(1);
    expect(recs[0].title).toBe("Starboy");
  });

  test("Threshold allows different songs by same artist", async () => {
    const target = {
      title: "Save Your Tears",
      channel: "The Weeknd",
      url: "https://youtube.com/watch?v=tears123456",
    };
    searchSpy.mockResolvedValue([target]);

    const recs = await youtube.getRecommendation(history);
    expect(recs).toHaveLength(1);
    expect(recs[0].title).toBe("Save Your Tears");
  });

  test("Noise words list is comprehensive", async () => {
    searchSpy.mockResolvedValue([
      {
        title: "Blinding Lights [REMASTERED 2024 HD]",
        url: "https://youtube.com/watch?v=remaster123",
      },
    ]);
    const recs = await youtube.getRecommendation(history);
    expect(recs).toHaveLength(0);
  });
});
