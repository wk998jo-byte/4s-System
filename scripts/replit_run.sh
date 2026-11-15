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

echo "[RUN] Python application import diagnostic"
"$ROOT/.venv/bin/python" - <<'CHECK'
try:
    import app.main
    print("APP_IMPORT: PASS", flush=True)
except Exception as exc:
    print("APP_IMPORT: FAIL", flush=True)
    print("ERROR_TYPE:", type(exc).__name__, flush=True)
    print("ERROR_MODULE:", type(exc).__module__, flush=True)
    # Avoid printing raw exception text: it may contain secrets.
    import traceback
    from pathlib import Path
    frames = traceback.extract_tb(exc.__traceback__)
    if frames:
        frame = frames[-1]
        print("ERROR_LOCATION:",
              f"{Path(frame.filename).name}:{frame.lineno}",
              flush=True)
    raise SystemExit(1)
CHECK

exec "$ROOT/.venv/bin/python" -m uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --proxy-headers
