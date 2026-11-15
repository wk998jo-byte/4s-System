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
python -m pip install -r requirements.txt

echo "[BUILD] SUCCESS"
