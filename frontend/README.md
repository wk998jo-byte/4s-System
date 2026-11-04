# SCC Platform UI (prototype)

React + TypeScript + Vite frontend for the Safety Command Center local prototype.

This is a **provisional** UI so the backend can be exercised visually. The app lives in `frontend/` so it can later be hosted independently.

**Limitations**

- No login. The API is unauthenticated in this milestone.
- Record data is whatever the FastAPI in-memory store currently holds. The UI does not invent server records.
- Operational SCC workflows are not implemented.

## Prerequisites

- Node.js 20+ (Vite tooling only; Node is not a second backend)
- The FastAPI app running on http://127.0.0.1:8000 (see `backend/README.md`)
- Windows PowerShell

## Setup

```powershell
cd frontend
copy .env.example .env
npm install
```

`.env` must contain:

```
VITE_API_BASE_URL=http://127.0.0.1:8000
```

That value is a public local URL. Never put database credentials or API secrets in frontend variables.

## Start the UI

In a **second** terminal (backend already running):

```powershell
cd frontend
npm run dev
```

| Resource | URL |
| --- | --- |
| Interface | http://127.0.0.1:5173 |
| Backend health | http://127.0.0.1:8000/api/v1/health |
| FastAPI docs | http://127.0.0.1:8000/docs |

If the connection pill is red, the UI cannot reach `VITE_API_BASE_URL`.

## Tests and production build

```powershell
cd frontend
npm test
npm run build
```

`npm test` runs a small unit test for API URL joining. `npm run build` type-checks and emits `dist/`.

## Troubleshooting

**CORS error**

The browser origin `http://127.0.0.1:5173` (or `http://localhost:5173`) must be listed in the backend `CORS_ORIGINS`. Restart uvicorn after changing it.

**Saved a record but the table is empty**

The POST failed or the GET after save failed. The form shows backend validation messages. Restarting the API clears in-memory records.

**Wrong host**

Use the same hostname in the browser and in `VITE_API_BASE_URL` if you mix `localhost` and `127.0.0.1`. CORS treats them as different origins.
