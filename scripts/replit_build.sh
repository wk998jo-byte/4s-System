#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[BUILD] Installing frontend dependencies"
cd frontend
npm ci --include=dev --no-audit --no-fund

echo "[BUILD] Building frontend"
npm run build
test -f dist/index.html

echo "[BUILD] Installing backend dependencies"
cd ../backend
# Keep Replit .pythonlibs out of the deployment virtual environment.
unset PYTHONPATH
unset PYTHONUSERBASE

python -m venv "$ROOT/.venv"
PIP_USER=false "$ROOT/.venv/bin/python" -m pip install --no-user -r requirements.txt
"$ROOT/.venv/bin/python" -m pip check

echo "[BUILD] Verifying isolated backend dependencies"
"$ROOT/.venv/bin/python" - <<'VERIFY'
import sys
import uvicorn
import fastapi
import psycopg
import sqlalchemy

assert ".venv" in uvicorn.__file__, "uvicorn imported outside venv"
assert ".venv" in fastapi.__file__, "fastapi imported outside venv"
assert ".venv" in psycopg.__file__, "psycopg imported outside venv"
assert ".venv" in sqlalchemy.__file__, "sqlalchemy imported outside venv"

print("ISOLATED BACKEND DEPENDENCIES: PASS")
print("Python:", sys.executable)
VERIFY

echo "[BUILD] SUCCESS"
