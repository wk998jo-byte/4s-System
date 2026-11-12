#!/usr/bin/env bash
# Staging/production entrypoint for Replit.
# Builds the SPA once, then serves API + static assets via a single Uvicorn.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export APP_ENV="${APP_ENV:-production}"
export PYTHONUNBUFFERED=1

if [[ -z "${PORT:-}" ]]; then
  export PORT=8000
fi

echo "[replit_start] building frontend…"
cd "$ROOT/frontend"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build

DIST="$ROOT/frontend/dist"
if [[ ! -f "$DIST/index.html" ]]; then
  echo "[replit_start] ERROR: frontend dist missing at $DIST" >&2
  exit 1
fi
export FRONTEND_DIST="${FRONTEND_DIST:-$DIST}"

echo "[replit_start] installing backend deps…"
cd "$ROOT/backend"
python -m pip install -r requirements.txt

# Prefer object storage on Replit unless operator overrides.
export MEDIA_BACKEND="${MEDIA_BACKEND:-replit}"

echo "[replit_start] starting uvicorn on 0.0.0.0:${PORT} (FRONTEND_DIST=$FRONTEND_DIST MEDIA_BACKEND=$MEDIA_BACKEND)"
exec python -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --proxy-headers --forwarded-allow-ips='*'
