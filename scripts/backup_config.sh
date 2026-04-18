#!/bin/bash
# Skynet Configuration and Environment Backup Utility
# Securely archives all unversioned, sensitive, and local state files to a safe location outside the git repository.

BACKUP_DIR="$HOME/skynet-backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
ARCHIVE_NAME="skynet_config_backup_$TIMESTAMP.tar.gz"

# Create the external backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "=== Skynet Backup Utility ==="
echo "Target: $BACKUP_DIR/$ARCHIVE_NAME"
echo "Aggregating unversioned state and configuration files..."

# Array of critical local files/directories
FILES=(
    ".env"
    "service-account.json"
    "youtube_cookies.txt"
    "metadata_cache.json"
    "twitterTopic.json"
    "voteTopic.json"
    "config/"
    "data/"
)

# Filter out targets that don't exist currently to avoid tar errors
VALID_FILES=()
for FILE in "${FILES[@]}"; do
    # -e checks if file/directory exists
    if [ -e "$FILE" ]; then
        VALID_FILES+=("$FILE")
        echo "  -> Found: $FILE"
    else
        echo "  -> Missing (Skipping): $FILE"
    fi
done

if [ ${#VALID_FILES[@]} -eq 0 ]; then
    echo "ERROR: No configuration files found to backup. Are you running this from the Skynet root?"
    exit 1
fi

echo ""
echo "Compressing into archive..."
tar -czf "$BACKUP_DIR/$ARCHIVE_NAME" "${VALID_FILES[@]}"

if [ $? -eq 0 ]; then
    echo "SUCCESS: Backup complete!"
    echo ""
    echo "To restore this backup on a fresh git clone:"
    echo "  1. Copy the archive into your new 'skynet' directory."
    echo "  2. Run:  tar -xzf $ARCHIVE_NAME"
else
    echo "ERROR: Compression failed."
fi
