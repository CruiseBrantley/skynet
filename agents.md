## Core Principle
When uncertain, look it up. Do not fabricate API signatures, file contents, config behavior, library behavior, or command output. If an available tool can resolve the uncertainty, use it.

## Environment
- macOS on Apple Silicon.
- Local inference using ollama via OpenAI-compatible endpoints.
- Prefer `rg` over `grep`.
- Prefer `fd` over `find` when available.

## Research
- Use the available web search tool for:
  - Current library versions
  - Recent APIs
  - Unfamiliar error messages
  - Package manager behavior
  - Anything likely to be stale in model training data
- Prefer primary sources: official docs, changelogs, source repositories, and issue trackers.

## Codebase Workflow
- Read files before editing them.
- Use `rg` to locate relevant sections before opening large files.
- Keep changes scoped to the request.
- Ask before refactors that touch more than 3 files or change public behavior, such as API surface, return types, function signatures, or exported names.
- Preserve existing style, naming, formatting, and architecture unless there is a clear reason to change them.

## Verification
- After code changes, run the project's relevant typecheck, lint, and tests when available.
- Do not claim work is complete without saying what verification ran.
- If verification could not be run, say why.

## Output Style
- Be direct.
- No unnecessary preamble.
- Push back on bad ideas or risky assumptions.
- When asked for code, provide complete corrected code blocks unless a diff or partial snippet is specifically requested.
- Do not re-summarize obvious changes unless asked.
- Surface important command errors instead of hiding them.

## Stop Conditions
- If the same test fails twice with the same root cause, stop and explain the blocker.
- If a tool returns an unexpected error, report it before trying a substantially different approach.
- If 5 or more tool calls make no progress on the same subproblem, stop and ask for direction.

## Anime Watchlist & Google Calendar
- The MyAnimeList account maintains the full watchlist, including past and active seasons.
- Only sync/schedule series to Google Calendar if they are currently airing (`anime_airing_status: 1`) or upcoming (`anime_airing_status: 3`).
- Stop adding releases to Google Calendar when a series has finished airing.
- Do NOT delete or remove old/completed entries from Google Calendar when a series finishes; historical calendar entries are preserved as an airing record.
- When an anime completes its seasonal run, sync automatically stops future calendar occurrences by truncating the recurrence rule (`UNTIL`) at series completion, ensuring outdated future events are cleared while preserving all past historical episode records.
- When an airing anime shifts broadcast day (e.g. Bleach shifting day of week), sync automatically detects the schedule drift from AniList, truncates the previous recurrence rule up to the shift date, and creates the new recurrence on the updated broadcast day, preserving all past episodes.
- Modifying the anime list (adding, removing, syncing, seeding) is strictly restricted to server `525112230006489091` in channel `1062784669034229780`, or users with owner permissions. The `/animelist` slash command is scoped specifically to guild `525112230006489091`. Viewing/listing is permitted across channels within that server.