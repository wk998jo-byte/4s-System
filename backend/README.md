# SCC Platform API (prototype)

Python FastAPI backend for the Safety Command Center local prototype.

**This is not production software.**

- Authentication uses **local Admin / Operator accounts** (SSO is not connected). Seeded logins: `admin` / `admin` and `operator` / `operator`.
- Operational SCC records persist in **SQLite** (`data/scc_platform.db`). Generic `POST /api/v1/records` remains in-memory.
- To use PostgreSQL later, install a server and set `DATABASE_URL` in `.env`.

## Prerequisites

- Python 3.12 (3.11+ should work)
- Windows PowerShell

## Setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
copy .env.example .env
```

If script execution is blocked:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## Start the API

From the `backend` folder, with the virtual environment active:

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

| Resource | URL |
| --- | --- |
| Health | http://127.0.0.1:8000/api/v1/health |
| OpenAPI docs | http://127.0.0.1:8000/docs |
| ReDoc | http://127.0.0.1:8000/redoc |
| Dashboard summary | http://127.0.0.1:8000/api/v1/dashboard/summary |
| Records | http://127.0.0.1:8000/api/v1/records |

Leave this terminal running. Start the frontend in a **second** PowerShell window (see `frontend/README.md`).

## CORS and the frontend URL

`CORS_ORIGINS` in `.env` must include the Vite origin, by default:

```
http://localhost:5173,http://127.0.0.1:5173
```

Do not set `CORS_ORIGINS=*` for a production `APP_ENV`. The settings class refuses a wildcard when `APP_ENV=production`.

## Tests

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pytest -q
```

## Database

The live API uses SQLite by default:

`backend/data/scc_platform.db`

Tables are created on startup (`list_items`, `cases`, `contacts`, `app_state`). Catalog lists are seeded once if empty.

Optional PostgreSQL:

```
DATABASE_URL=postgresql+psycopg://scc:scc@127.0.0.1:5432/scc_platform
```

`POST /api/v1/records` still uses `InMemoryRecordStore` (generic prototype records only).

## Troubleshooting

**Frontend cannot reach the API**

- Confirm uvicorn is running on port 8000.
- Open http://127.0.0.1:8000/api/v1/health in the browser.
- Check `VITE_API_BASE_URL` in the frontend `.env` (no trailing-slash issues; the client joins paths).

**CORS error in the browser console**

- Frontend origin (exact scheme + host + port) must appear in `CORS_ORIGINS`.
- Restart uvicorn after changing `.env`.

**Records vanished**

- SCC cases, weather, contacts, and hardware counts survive API restarts (SQLite file). Generic `/api/v1/records` entries still reset.
