#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export APP_ENV="${APP_ENV:-production}"
export MEDIA_BACKEND="${MEDIA_BACKEND:-replit}"
export FRONTEND_DIST="$ROOT/frontend/dist"
export PORT="${PORT:-8000}"
export PYTHONUNBUFFERED=1

test -f "$FRONTEND_DIST/index.html" || {
  echo "[RUN] ERROR: Frontend build missing"
  exit 1
}

cd backend
echo "[RUN] Starting FastAPI on port $PORT"

test -x "$ROOT/.venv/bin/python" || {
  echo "[RUN] ERROR: Python virtual environment missing"
  exit 1
}

# Prevent Replit development site-packages from overriding venv dependencies.
unset PYTHONPATH
unset PYTHONUSERBASE

exec "$ROOT/.venv/bin/python" -m uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --proxy-headers
