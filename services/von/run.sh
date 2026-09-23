#!/usr/bin/env bash
# Start the local Von System One Decision Model HTTP server
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_BIN="$DIR/venv/bin"

if [ ! -f "$VENV_BIN/von" ]; then
  echo "Error: Von virtualenv not found at $VENV_BIN. Run setup first."
  exit 1
fi

HOST="${VON_HOST:-127.0.0.1}"
PORT="${VON_PORT:-8000}"
DEVICE="${VON_DEVICE:-auto}"

echo "Starting Von System One HTTP Server on http://$HOST:$PORT (device: $DEVICE)..."
exec "$VENV_BIN/von" serve --host "$HOST" --port "$PORT" --device "$DEVICE"
