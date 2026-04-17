# Skynet

A high-fidelity music player and multipurpose Discord bot with AI chat, image generation, TTS, Twitch stream announcements, and more.

## Quick Start

1. **Clone & Install**
   ```bash
   git clone https://github.com/CruiseBrantley/skynet.git
   cd skynet
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your own values. At minimum you need:
   - `TOKEN` — Your Discord bot token
   - `CLIENT_ID` — Your bot's application ID
   - `BOT_NAME` — Your bot's display name (used in prompts and UI)

3. **Configure Bot Personality** (Optional)
   Edit `config/system_prompt.txt` to customize the AI assistant's personality and behavior.

4. **Configure Twitch Announcements** (Optional)
   ```bash
   cp config/announcements.json.template config/announcements.json
   ```
   Edit `config/announcements.json` with your Twitch streamer IDs and Discord channel IDs.

5. **Run**
   ```bash
   npm run dev-env    # Development
   npm start          # Production
   ```

## Configuration Reference

| Env Var | Required | Description |
|---------|----------|-------------|
| `TOKEN` | ✅ | Discord bot token |
| `CLIENT_ID` | ✅ | Discord application ID |
| `BOT_NAME` | ❌ | Bot display name (default: `Bot`) |
| `BOT_ACTIVITY` | ❌ | Status activity text (default: `for you`) |
| `OLLAMA_REMOTE_HOST` | ❌ | Remote Ollama server IP |
| `OLLAMA_REMOTE_PORT` | ❌ | Remote Ollama server port (default: `11434`) |
| `OLLAMA_REMOTE_MODEL` | ❌ | Remote Ollama model name |
| `OLLAMA_LOCAL_MODEL` | ❌ | Local fallback model name |
| `GEMINI_API_KEY` | ❌ | Google Gemini API key (Level 1 fallback) |
| `GEMINI_MODEL` | ❌ | Gemini model name |
| `SWARMUI_REMOTE_URL` | ❌ | Remote SwarmUI endpoint |
| `SWARMUI_LOCAL_URL` | ❌ | Local SwarmUI fallback |
| `COMFYUI_URL` | ❌ | ComfyUI direct API endpoint |
| `TTS_MODEL` | ❌ | Piper TTS voice model filename |
| `TWITCH_CLIENTID` | ❌ | Twitch app client ID |
| `TWITCH_SECRET` | ❌ | Twitch app secret |
| `OWNER_ID` | ❌ | Discord user ID for admin commands |

See `.env.example` for the full list of available configuration options.

## Configuration Backup & Restore

Skynet relies on several critical unversioned files (API keys, session cookies, local JSON databases, and environment files) that are actively excluded from Git. 

To easily backup all these local states into a highly compressed archive outside the repository:
```bash
./scripts/backup_config.sh
```
This utility auto-aggregates `.env`, `youtube_cookies.txt`, `service-account.json`, and all `config/*.json` files into a timestamped `.tar.gz` in your `~/skynet-backups/` directory.

**To restore on a fresh clone:**
1. Copy the generated `.tar.gz` archive directly into the root of the new `skynet` repository.
2. Run `tar -xzf skynet_config_backup_YYYY-MM-DD.tar.gz`. The paths will unpack exactly into their original relative structures automatically.

## Features

- **AI Chat** — Multi-tier LLM with automatic failover (Remote → Gemini → Local)
- **Music Player** — High-fidelity YouTube playback with queue management and cinematic UI
- **Image Generation** — SwarmUI/ComfyUI integration with model selection
- **Text-to-Speech** — Local Piper TTS with voice channel support
- **Twitch Announcements** — Automatic stream notifications with deduplication
- **Web Search** — Google → DuckDuckGo → Wikipedia fallback chain
- **URL Summarization** — Automatic link summarization in configured channels

## Testing

```bash
npm test
```

The test suite includes extensive mocks for Discord.js, YouTube, and LLM tiers for fast, reliable local verification. GitHub Actions CI runs tests on every push.

## Deployment

The bot can be deployed as a macOS Launch Agent. See [MACOS_MANAGEMENT.md](MACOS_MANAGEMENT.md) for details.

```bash
# Restart the service
launchctl kickstart -k gui/$(id -u)/com.user.skynet
```

## 🤖 Instructions for AI Assistants

1. **Service Management**: Read [MACOS_MANAGEMENT.md](MACOS_MANAGEMENT.md) before restarting the bot.
2. **Test-Driven Development**: Run `npm test` after modifying core logic. Maintain 100% pass rate.
3. **Music Fidelity**: Volume normalization and stable YouTube playback are critical.
