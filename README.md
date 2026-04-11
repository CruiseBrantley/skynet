# Skynet

A high-fidelity music player and multipurpose Discord bot.

## 🤖 Instructions for AI Assistants
If you are an AI assistant working on this repository, please adhere to the following guidelines:

1. **Service Management**: The bot is deployed as a macOS Launch Agent. Before attempting to restart the bot or diagnosing service issues, **read [MACOS_MANAGEMENT.md](MACOS_MANAGEMENT.md)**.
   - Restart the service using: `launchctl kickstart -k gui/$(id -u)/com.user.skynet`
2. **Test-Driven Development**: Maintain high confidence in code changes by utilizing the test suite.
   - Run tests with `npm test`.
   - **Requirement**: If you modify core logic (especially in `MusicManager.js`, `GuildQueue.js`, or `YouTubeMetadata.js`), you **must** run the unit tests and update them if necessary to ensure 100% pass rate and coverage of new features.
   - GitHub Actions CI is configured to run tests on every push.
3. **Music Fidelity**: Volume normalization and stable YouTube playback are critical. Use `YouTubeMetadata.js` for enriched metadata and `MusicManager.js` for queue state.

## Getting Started
1. Install dependencies: `npm install`
2. Configure `.env` (see `.env.example` if available, or check `util/` for required keys)
3. Run locally for development: `npm run dev-env`
4. Deploy/Restart via Launch Agent: See `MACOS_MANAGEMENT.md`

## Testing
```bash
npm test
```
The test suite includes extensive mocks for Discord.js, YouTube, and LLM tiers to allow for fast, reliable local verification.
