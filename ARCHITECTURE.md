# Skynet Infrastructure & Network Architecture

This document details the complete physical, network, and software architecture powering Skynet and its external integration pipelines. Use this reference to troubleshoot, recreate, or migrate any part of the infrastructure.

---

## 1. Network & Ingress Topology

```
                       [ Twitch API / Discord Gateway / External Internet ]
                                                │
                                                ▼ (WAN)
                                  ┌───────────────────────────┐
                                  │      ASUS Router WAN      │
                                  │       (192.168.50.1)      │
                                  │   DDNS: sirian.ddns.net   │
                                  └─────────────┬─────────────┘
                                                │
                     ┌──────────────────────────┴──────────────────────────┐
                     │ Port Forwarding (443/TCP)                           │
                     ▼                                                     ▼
      ┌─────────────────────────────┐                       ┌─────────────────────────────┐
      │   Raspberry Pi (Reverse)    │                       │     Mac Mini Host (M4)      │
      │       192.168.50.61         │                       │       192.168.50.133        │
      │  lighttpd 1.4.69 + Certbot  │                       │                             │
      │  Let's Encrypt / DDNS SSL   │                       │  Skynet Discord Bot Daemon  │
      └──────────────┬──────────────┘                       │  Express Web Server (:3000) │
                     │                                      │  Local Piper TTS Engine     │
                     └──────── Proxy Pass (HTTP) ──────────►│  Launchd: com.user.skynet   │
                                                            └──────────────┬──────────────┘
                                                                           │
                                                                           │ (LAN: 11434/TCP)
                                                                           ▼
                                                            ┌─────────────────────────────┐
                                                            │     Remote AI Workstation   │
                                                            │       192.168.50.182        │
                                                            │    NVIDIA RTX 5090 (32GB)   │
                                                            │  Ollama / Qwen 3.8 27B / CUI│
                                                            └─────────────────────────────┘
```

---

## 2. Twitch EventSub Webhook Pipeline

### Ingress Flow:
1. **Subscription Registration**: On bot startup (or `/twitch-notify sync`), Skynet issues OAuth2 credentials and calls Twitch Helix API (`POST https://api.twitch.tv/helix/eventsub/subscriptions`) requesting `stream.online` webhook callbacks to `https://sirian.ddns.net/twitch`.
2. **Challenge Handshake**: Twitch sends an initial `POST` request containing a verification `challenge` token.
3. **Public DNS / Port Routing**: `sirian.ddns.net` resolves to public WAN IP → ASUS Router forwards port 443 to `192.168.50.61` (Raspberry Pi) → `lighttpd` terminates SSL → forwards Skynet traffic (`/twitch`, `/chat`, `/api/chat`, `/api/conversations`) to Skynet on `http://192.168.50.133:3000`. (All other paths forward to port 4000).
4. **Validation & Deduplication**: Skynet validates headers, responds with `200 OK` + `body.challenge`, and deduplicates Twitch retry message IDs in memory (`processedMessageIds`).
5. **Discord Announcement**: When a streamer goes live, Skynet fetches channel/game metadata and dispatches formatted embeds to the designated Discord channels configured in `config/announcements.json`.

---

## 2.1 Web Chat UI & Streaming API (`/chat`)

- **Web Chat UI**: Accessible publicly at `https://sirian.ddns.net/chat` (and locally at `http://192.168.50.133:3000/chat`).
- **Endpoints**:
  - `GET /chat`: Serves the mobile-responsive chat frontend (`public/index.html`).
  - `POST /api/chat`: Supports Server-Sent Events (SSE) streaming token responses from the central AI engine, authenticated via session cookies.
  - `GET /api/conversations/history`: Hydrates persistent chat history directly from `data/conversations/{profile}.json` scoped to the authenticated caller.
  - `GET /api/auth/providers`: Returns list of available enabled OAuth providers (Discord, Twitch, etc.).
  - `GET /api/auth/:provider/login`: Initiates OAuth flow with the chosen identity provider.
  - `GET /api/auth/:provider/callback`: Validates OAuth callback, generates signed HMAC `skynet_session` cookie, and redirects to `/chat`.
  - `GET /api/auth/me`: Returns active authenticated user identity, display name, avatar, and owner status.
  - `POST /api/auth/logout`: Clears active session cookie.
- **Identity Architecture**:
  - `server/auth/BaseAuthProvider.js`: Pluggable abstract class for adding new identity providers.
  - `server/auth/DiscordAuthProvider.js` & `server/auth/TwitchAuthProvider.js`: Out-of-the-box provider implementations.
  - `server/auth/AuthManager.js`: Central session signing, user store (`data/users.json`), and profile resolver (`sirian` for owner vs `user_<provider>_<id>` for others).

---

## 3. SSL / TLS Certificate Lifecycle (Raspberry Pi)

- **Domain**: `sirian.ddns.net`
- **Host**: `pi@192.168.50.61`
- **Web Server**: `lighttpd 1.4.69`
- **Certificate Path**: `/etc/letsencrypt/live/sirian.ddns.net/`

### Automated Renewal Configuration:
1. **Systemd Timer**: `certbot.timer` is enabled and active, checking certificate expiration twice daily.
2. **Deploy Hook**: `/etc/letsencrypt/renewal-hooks/deploy/restart-lighttpd.sh`
   ```bash
   #!/bin/bash
   systemctl restart lighttpd
   ```
   *Whenever Certbot successfully renews the certificate, it triggers this hook to reload `lighttpd` into memory with zero downtime.*

### Manual Inspection & Emergency Recovery:
```bash
# Check certificate status on Pi
ssh pi@192.168.50.61 "sudo certbot certificates"

# Force renewal dry-run
ssh pi@192.168.50.61 "sudo certbot renew --dry-run"

# Restart web server
ssh pi@192.168.50.61 "sudo systemctl restart lighttpd"

# Test external handshake from Mac
curl -Iv https://sirian.ddns.net/twitch
```

---

## 4. Fallback / Alternative Ingress: Ngrok Tunnel

If the local reverse proxy (`192.168.50.61`) or router port forwarding is ever unavailable:
1. Open `.env` on this Mac.
2. Comment out or remove `TWITCH_CALLBACK_URL`:
   ```env
   # TWITCH_CALLBACK_URL=https://sirian.ddns.net/twitch
   ```
3. Restart Skynet:
   ```bash
   launchctl kickstart -k gui/$(id -u)/com.user.skynet
   ```
4. Skynet will automatically activate its built-in `@ngrok/ngrok` tunnel using `NGROK_AUTH_TOKEN`, provisioning an automated HTTPS callback URL with cloud-managed certificates.

---

## 5. Multi-Tier AI & Tool Execution Hierarchy

Skynet routes inference and synthesis across three hardware tiers:

1. **Level 0 (Primary Engine — LAN Remote)**:
   - **Endpoint**: `http://192.168.50.182:11434`
   - **Hardware**: NVIDIA RTX 5090
   - **Model**: `qwen3.8:27b-5090` / Vision / Code Synthesis
2. **Level 2 (Cloud Fallback & Search Grounding)**:
   - **Endpoint**: Google Gemini API (`v1beta`)
   - **Models**: `gemini-2.5-flash` → `gemini-3.7-flash` → `gemini-3.5-flash`
   - **Capabilities**: Google Search Grounding (`tools: [{ googleSearch: {} }]`), Large Context, Multimodal
3. **Level 1 (Local Failover — Mac Mini)**:
   - **Endpoint**: `http://127.0.0.1:11434` (Apple Silicon M-series)
   - **Model**: `gemma4:latest` / Local fallback

---

## 6. Service Management (macOS Launchd)

- **Daemon Label**: `com.user.skynet`
- **Plist Location**: `~/Library/LaunchAgents/com.user.skynet.plist`
- **Working Directory**: `/Users/cruise/git/skynet`

```bash
# Restart daemon (applies code and env changes)
launchctl kickstart -k gui/$(id -u)/com.user.skynet

# Stop daemon
launchctl bootout gui/$(id -u)/com.user.skynet

# Start daemon
launchctl bootstrap gui/$(id -u)/com.user.skynet ~/Library/LaunchAgents/com.user.skynet.plist
```
