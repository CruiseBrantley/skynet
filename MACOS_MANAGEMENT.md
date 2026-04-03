# Skynet macOS Service Management

The Skynet bot is configured as a macOS **Launch Agent** to ensure it starts automatically at login and remains persistent if it crashes.

## Service Details
- **Label**: `com.user.skynet`
- **Definition File**: `~/Library/LaunchAgents/com.user.skynet.plist`
- **Root Directory**: `~/git/skynet`
- **Runtime**: `/opt/homebrew/bin/node`

## Management Commands

Use `launchctl` to control the service from your terminal:

### Restart Service (Recommended)
This is the safest way to apply changes to `.env` or code:
```bash
launchctl kickstart -k gui/$(id -u)/com.user.skynet
```

### Stop Service
```bash
launchctl bootout gui/$(id -u)/com.user.skynet
```

### Start Service
```bash
launchctl bootstrap gui/$(id -u)/com.user.skynet ~/Library/LaunchAgents/com.user.skynet.plist
```

## Logs and Debugging

If the bot isn't responding, check the launchd output logs in the `logs/` directory:

- **Standard Output**: `logs/launchd_out.log`
- **Error Log**: `logs/launchd_err.log`

To watch logs in real-time:
```bash
tail -f logs/launchd_out.log
```

## Maintenance Tips
1. **Adding Environment Variables**: When you modify the `.env` file, you **must** restart the service for the changes to take effect.
2. **Bot Crashes**: The `KeepAlive` key in the plist is set to `true`, so macOS will automatically attempt to restart the bot if it exits unexpectedly.
3. **Updating Code**: After a `git pull` or manual edits, run the **Restart Service** command above.
