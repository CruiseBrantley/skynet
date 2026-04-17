#!/bin/bash

# Configuration
PROJECT_DIR="$(pwd)"
YT_DLP="$PROJECT_DIR/tts_engine/piper_venv/bin/yt-dlp"
COOKIE_FILE="$PROJECT_DIR/youtube_cookies.txt"

echo "Starting YouTube cookie sync from Safari..."

# Extract cookies using yt-dlp
# requires Full Disk Access for the terminal
$YT_DLP --cookies-from-browser safari --cookies "$COOKIE_FILE" --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ" > /dev/null 2>&1

if [ -f "$COOKIE_FILE" ]; then
    echo "Successfully synced YouTube cookies to $COOKIE_FILE"
    exit 0
else
    echo "Failed to sync cookies. Ensure Full Disk Access is granted and Safari is the browser used."
    exit 1
fi
