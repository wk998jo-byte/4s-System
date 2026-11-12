# SCC Platform — Phase 6B Staging Gate (STOP before publish)

**Date:** 2026-11-12  
**Branch (local only):** `staging/phase6b-rc`  
**RC revision:** `26c88e3` (not pushed)  
**Base:** `main` @ `128ce49`  
**Scope:** Staging RC prep, App Storage object adapter, Replit runtime artifacts  
**Safety:** No publish. No push. No ops SQLite migration. Synthetic data only.

---

## Final gates

| Gate | Status |
|------|--------|
| **STAGING RC (local)** | **PASS** (branch + tests; not pushed) |
| **BACKEND TESTS** | **PASS** (**68** pytest) |
| **FRONTEND TESTS** | **PASS** (**5** vitest) |
| **FRONTEND BUILD** | **PASS** |
| **MEDIA ADAPTER (code)** | **PASS** (`MEDIA_BACKEND=local\|replit`) |
| **MEDIA ON REPLIT** | **NOT VERIFIED** (needs live App Storage bucket) |
| **REPLIT DATABASE** | **NOT PROVISIONED** (await operator) |
| **MIGRATIONS 001–003 ON STAGING** | **NOT APPLIED** (no staging DB yet) |
| **PUBLISH** | **BLOCKED — awaiting explicit approval** |
| **STEP 6 LIVE ACCEPTANCE** | **NOT STARTED** |

---

## Step 1 — Staging release candidate

### Included (Phase 3A → 6B)

- Auth/media_token, rate limit, dashboard integrity, production DB fail-fast
- Migrations `001`–`003`, PG scripts, phase test suites
- Weather/HW PG acceptance paths
- **New:** `media_store.py` (local + Replit object SDK), `.replit`, `scripts/replit_start.sh`
- Dhahran Key Personnel trim (already on `main`)

### Excluded / not in git by design

- `docs/` (gitignored) — operator copies remain on disk
- `backend/data/*.db`, uploads, `.env`, secrets
- No production credentials

### Reproducible build

```text
cd frontend && npm ci && npm run build
cd backend && pip install -r requirements.txt
# local:
uvicorn app.main:app --host 127.0.0.1 --port 8000
# staging (Replit):
bash scripts/replit_start.sh
```

### Git recommendation

| Action | Status |
|--------|--------|
| Local branch `staging/phase6b-rc` | Created |
| Commit RC on that branch | **Done locally** (`26c88e3`) |
| Push to origin | **Not authorized** |
| Publish Replit | **Not authorized** |

Prefer **private branch + controlled Replit import** of this RC — do not publish over an existing production Deployment.

---

## Step 2 — Replit database (operator required)

This environment has **no live Replit workspace control**. Cannot invent a PASS.

**Required operator actions:**

1. Open a **dedicated staging** Repl (new project — do not overwrite production).
2. Create / attach **Replit PostgreSQL** (or Neon/etc. only if isolated staging).
3. Confirm DB is **empty** and not linked to ops SQLite / production.
4. Set Secrets (names only — see below).
5. Apply migrations to that empty DB only:

```text
psql "$DATABASE_URL" -f backend/migrations/001_postgresql_baseline.sql
# After empty-DB confirm (or ITQAN duplicate inventory if any seed):
psql "$DATABASE_URL" -f backend/migrations/002_itqan_ref_unique.sql
psql "$DATABASE_URL" -f backend/migrations/003_foreign_keys.sql
```

6. Verify ITQAN unique index exists (`\d` / catalog query).

**Config:** `APP_ENV=production`, `SEED_DEMO_CASES=false`, `SEED_DEMO_USERS=false`.

---

## Step 3 — Persistent media (App Storage)

**Finding:** App Storage is an **object API**, not a filesystem mount.

| Item | Status |
|------|--------|
| Adapter `ReplitObjectMediaStore` | Implemented |
| SDK `replit-object-storage==1.0.2` | In `requirements.txt` |
| Auth (`media_token` / Bearer) | Preserved |
| Project ACL + orphan owner map | Preserved |
| Object keys `MEDIA_KEY_PREFIX` + `stored_name` | Designed |
| Session tokens in URLs | Legacy `access_token` off in production |
| Live Replit restart/republish persistence | **NOT VERIFIED** |

Set `MEDIA_BACKEND=replit` and optional `REPLIT_BUCKET_ID` in Secrets after creating a private bucket in the Replit App Storage UI.

---

## Step 4 — Staging runtime

| Item | Value |
|------|--------|
| Process | Single Uvicorn (`scripts/replit_start.sh`) |
| Frontend | Vite production `FRONTEND_DIST` (no Vite dev) |
| Bind | `0.0.0.0:$PORT` |
| Health | `GET /api/v1/health` |
| Ready | `GET /api/v1/ready` (DB + media probe + reports `media_backend`) |
| Rate limit | In-process; prefer **single instance** until shared limiter exists |
| HTTPS | Replit edge (verify after publish) |

Artifacts: `.replit`, `scripts/replit_start.sh`.

---

## Step 5 — Pre-publish gate (STOP)

| Field | Value |
|-------|--------|
| **Exact target Replit project** | **UNKNOWN — operator must name staging Repl** |
| **Not production?** | Must be confirmed by operator before publish |
| **Git revision / RC** | `26c88e3` on `staging/phase6b-rc` (**unpushed**); base `128ce49` |
| **Staging DB identity** | **Not provisioned** (redacted N/A) |
| **App Storage bucket** | **Not provisioned** |
| **Deployment type** | `.replit` → `cloudrun` target (verify in UI) |
| **Build/start** | `bash scripts/replit_start.sh` |
| **Secret names (no values)** | `APP_ENV`, `DATABASE_URL`, `CORS_ORIGINS`, `FRONTEND_DIST`, `MEDIA_BACKEND`, `REPLIT_BUCKET_ID`, `MEDIA_KEY_PREFIX`, `SEED_DEMO_CASES`, `SEED_DEMO_USERS`, `ALLOW_LEGACY_UPLOAD_ACCESS_TOKEN`, `SESSION_TTL_MINUTES`, `MEDIA_TOKEN_TTL_MINUTES`, `AUTH_RATE_LIMIT_PER_MINUTE`, `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_DISPLAY_NAME` |
| **Resources** | Not visible from this workstation |
| **Remaining risks** | Unverified media persistence; multi-instance rate-limit; CORS custom domain; bootstrap password handling; ops DB size drift locally (see below) |

### Local ops SQLite note

| Metric | Phase 6A | Now |
|--------|----------|-----|
| Path | `backend/data/scc_platform.db` | same |
| Size | 671744 | **692224** (file locked during hash; **do not claim unchanged**) |

**Do not migrate this file.** Staging must use empty Postgres only.

---

## Step 6 — After authorized publish (checklist)

Only after explicit “publish staging” approval, verify on the HTTPS staging URL:

1. Login / logout  
2. Session expiry  
3. AI Camera create + approve  
4. Dashcam create + approve  
5. GPS/Speed create + approve  
6. SOS Operator direct-close (no Admin approve)  
7. ITQAN uniqueness  
8. Weather hourly + weekly  
9. Hardware register / import / transfer / receive  
10. Project + user authorization  
11. Dashboard KPIs  
12. Weekly/monthly reports  
13. Private media upload/download + denial  
14. Image persistence after restart + republish  
15. Staging DB backup → restore into a **separate** test DB  

---

## GO / NO-GO

| Recommendation | **NO-GO for publish** |
|----------------|------------------------|
| Reason | Staging DB + App Storage bucket + target Repl not confirmed; media persistence untested on Replit |
| Next | Operator provides staging Repl name, empty Postgres, App Storage bucket id; then authorize Secrets + migrations + **explicit publish** |

**STOP.** Awaiting explicit operator approval before any Publish/Republish or remote push.
