#!/usr/bin/env bash
# Start the local System One Decision Model HTTP server (Laya or Von)
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_BIN="$DIR/venv/bin"

ENGINE="${SYSTEM1_ENGINE:-laya}"
HOST="${VON_HOST:-127.0.0.1}"
PORT="${VON_PORT:-8000}"
DEVICE="${VON_DEVICE:-cpu}"

if [ "$ENGINE" = "laya" ]; then
  if [ ! -f "$VENV_BIN/laya-serve" ]; then
    echo "Error: laya-serve not found at $VENV_BIN. Run setup first."
    exit 1
  fi
  export LAYA_HOST="$HOST"
  export LAYA_PORT="$PORT"
  export LAYA_DEVICE="$DEVICE"
  export LAYA_MODELS="${LAYA_MODELS:-english}"
  export LAYA_PRELOAD=1
  echo "Starting Laya System One HTTP Server on http://$HOST:$PORT (device: $DEVICE, models: $LAYA_MODELS)..."
  exec "$VENV_BIN/laya-serve"
else
  if [ ! -f "$VENV_BIN/von" ]; then
    echo "Error: Von virtualenv not found at $VENV_BIN. Run setup first."
    exit 1
  fi
  MODEL="${VON_MODEL:-von-1.3}"
  echo "Starting Von System One HTTP Server on http://$HOST:$PORT (model: $MODEL, device: $DEVICE)..."
  exec "$VENV_BIN/von" serve --host "$HOST" --port "$PORT" --device "$DEVICE" --model "$MODEL"
fi
