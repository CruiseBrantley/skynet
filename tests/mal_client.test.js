const malClient = require("../util/malClient")
const axios = require("axios")
const fs = require("fs")
const path = require("path")

jest.mock("axios")
jest.mock("../logger")

describe("MalClient - MyAnimeList v2 API Integration", () => {
  const AUTH_FILE = path.join(__dirname, "../data/mal_auth.json")
  let originalAuth = null

  beforeAll(() => {
    process.env.MAL_CLIENT_ID = "mock_client_id_1234567890123456"
    process.env.MAL_CLIENT_SECRET = "mock_client_secret_abcdef1234567890abcdef1234567890abcdef1234567890"
    process.env.MYANIMELIST_USERNAME = "test_skynet_user"
    process.env.MAL_REDIRECT_URI = "http://localhost:3000/mal/callback"
    if (fs.existsSync(AUTH_FILE)) {
      originalAuth = fs.readFileSync(AUTH_FILE, "utf8")
    }
  })

  afterAll(() => {
    if (originalAuth) {
      fs.writeFileSync(AUTH_FILE, originalAuth, "utf8")
    } else if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE)
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test("isConfigured returns true when credentials exist", () => {
    expect(malClient.isConfigured()).toBe(true)
  })

  test("generatePkce produces valid 128-char verifier and plain challenge", () => {
    const { verifier, challenge } = malClient.generatePkce()
    expect(verifier.length).toBe(128)
    expect(challenge).toBe(verifier)
    expect(verifier).toMatch(/^[0-9a-f]{128}$/)
  })

  test("getAuthUrl formats correct MAL authorization link with plain PKCE", () => {
    const url = malClient.getAuthUrl()
    expect(url).toContain("https://myanimelist.net/v1/oauth2/authorize")
    expect(url).toContain("response_type=code")
    expect(url).toContain("client_id=mock_client_id")
    expect(url).toContain("code_challenge=")
    expect(url).toContain("code_challenge_method=plain")
    expect(url).toContain(encodeURIComponent("http://localhost:3000/mal/callback"))
  })

  test("handleCallback exchanges auth code for tokens and saves them", async () => {
    malClient._saveAuth({ pending_verifier: "test_verifier_string_12345" })

    axios.post.mockResolvedValueOnce({
      data: {
        token_type: "Bearer",
        expires_in: 2678400,
        access_token: "mock_access_token_xyz",
        refresh_token: "mock_refresh_token_xyz"
      }
    })

    const result = await malClient.handleCallback("auth_code_from_mal")
    expect(result.success).toBe(true)
    expect(axios.post).toHaveBeenCalledTimes(1)
    expect(malClient.isAuthenticated()).toBe(true)
  })

  test("getValidToken returns current token when valid", async () => {
    malClient._saveAuth({
      access_token: "valid_access_token_123",
      refresh_token: "mock_refresh_token_xyz",
      expires_at: Date.now() + 1000000
    })

    const token = await malClient.getValidToken()
    expect(token).toBe("valid_access_token_123")
    expect(axios.post).not.toHaveBeenCalled()
  })

  test("getValidToken automatically refreshes expired token", async () => {
    malClient._saveAuth({
      access_token: "old_token",
      refresh_token: "valid_refresh_token",
      expires_at: Date.now() - 1000
    })

    axios.post.mockResolvedValueOnce({
      data: {
        access_token: "refreshed_access_token",
        refresh_token: "new_refresh_token",
        expires_in: 2678400
      }
    })

    const token = await malClient.getValidToken()
    expect(token).toBe("refreshed_access_token")
    expect(axios.post).toHaveBeenCalledTimes(1)
  })

  test("addAnime sends PUT request to MAL list endpoint", async () => {
    malClient._saveAuth({
      access_token: "valid_token",
      expires_at: Date.now() + 1000000
    })

    axios.put.mockResolvedValueOnce({
      data: { status: "watching", score: 0 }
    })

    const result = await malClient.addAnime(52991, { status: "watching" })
    expect(result.success).toBe(true)
    expect(result.animeId).toBe(52991)
    expect(axios.put).toHaveBeenCalledWith(
      "https://api.myanimelist.net/v2/anime/52991/my_list_status",
      "status=watching",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer valid_token"
        })
      })
    )
  })

  test("removeAnime sends DELETE request to MAL list endpoint", async () => {
    malClient._saveAuth({
      access_token: "valid_token",
      expires_at: Date.now() + 1000000
    })

    axios.delete.mockResolvedValueOnce({ data: {} })

    const result = await malClient.removeAnime(52991)
    expect(result.success).toBe(true)
    expect(axios.delete).toHaveBeenCalledWith(
      "https://api.myanimelist.net/v2/anime/52991/my_list_status",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer valid_token"
        })
      })
    )
  })
})