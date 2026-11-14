# SCC Platform — Phase 6B Staging Gate (STOP before publish)

**Date:** 2026-11-14 (resumed)  
**Branch (local only):** `staging/phase6b-rc`  
**RC tip:** see `git log -1` on this branch (unpushed)  
**Base:** `main` @ `128ce49`  
**Scope:** Staging RC + migration rehearsal + App Storage adapter + Replit runtime  
**Safety:** No publish. No push. No ops SQLite migration. Synthetic / disposable DBs only.

---

## Final gates

| Gate | Status |
|------|--------|
| **STAGING RC (local)** | **PASS** (branch; not pushed) |
| **BACKEND TESTS** | **PASS** (**68** pytest, reconfirmed 2026-11-14) |
| **FRONTEND TESTS** | **PASS** (**5** vitest, reconfirmed) |
| **FRONTEND BUILD** | **PASS** (prior RC) |
| **MEDIA ADAPTER (code)** | **PASS** (`MEDIA_BACKEND=local\|replit`) |
| **MEDIA ON REPLIT** | **NOT VERIFIED** |
| **LOCAL STAGING SCHEMA REHEARSAL** | **PASS** (empty `scc_phase6b` + 001–003 + ITQAN index) |
| **REPLIT DATABASE** | **NOT PROVISIONED** |
| **MIGRATIONS ON REPLIT STAGING** | **NOT APPLIED** |
| **PUBLISH** | **BLOCKED — awaiting explicit approval** |
| **STEP 6 LIVE ACCEPTANCE** | **NOT STARTED** |

---

## Progress since resume

1. Reconfirmed test suites (**68** / **5**).
2. Added `backend/scripts/phase6b_apply_staging_migrations.py` (empty-DB guard; refuses SQLite).
3. Local disposable rehearsal: created empty `scc_phase6b`, applied `001`–`003`, verified `uq_cases_itqan_ref_active` **PRESENT** → **PASS**.
4. Runtime artifacts already on branch: `.replit`, `scripts/replit_start.sh`, `media_store.py`.

---

## Step 5 — Pre-publish gate (STOP)

| Field | Value |
|-------|--------|
| **Exact target Replit project** | **UNKNOWN — you must name the staging Repl** |
| **Not production?** | Must confirm |
| **Git revision / RC** | `staging/phase6b-rc` (**unpushed**) |
| **Staging DB identity** | Replit: **not provisioned**. Local rehearsal only: `scc_phase6b` @ 127.0.0.1 (disposable) |
| **App Storage bucket** | **Not provisioned** |
| **Deployment type** | `.replit` → `cloudrun` (verify in UI) |
| **Build/start** | `bash scripts/replit_start.sh` |
| **Secret names (no values)** | `APP_ENV`, `DATABASE_URL`, `CORS_ORIGINS`, `FRONTEND_DIST`, `MEDIA_BACKEND`, `REPLIT_BUCKET_ID`, `MEDIA_KEY_PREFIX`, `SEED_DEMO_CASES`, `SEED_DEMO_USERS`, `ALLOW_LEGACY_UPLOAD_ACCESS_TOKEN`, `SESSION_TTL_MINUTES`, `MEDIA_TOKEN_TTL_MINUTES`, `AUTH_RATE_LIMIT_PER_MINUTE`, `BOOTSTRAP_ADMIN_*` |
| **Rate-limit** | Prefer **single instance** until shared limiter exists |

### Operator actions required next

Reply with **all** of the following to unblock:

1. **Staging Repl name / URL** (confirm it is **not** production).  
2. Authorization to **push** `staging/phase6b-rc` (or alternate import method).  
3. Confirm empty **Replit Postgres** is ready (or paste redacted host/db name only).  
4. Confirm **App Storage** bucket created (bucket id optional).  
5. Explicit sentence: **“Authorize staging publish”** (or “do not publish yet”).

After that, apply migrations on Replit with:

```text
DATABASE_URL=postgresql+psycopg://…  python -m scripts.phase6b_apply_staging_migrations
```

Then Secrets from `docs/REPLIT_STAGING_ENV.example.md`, start via `scripts/replit_start.sh`, and run Step 6 live checklist on HTTPS.

---

## GO / NO-GO

| Recommendation | **NO-GO for publish** |
|----------------|------------------------|
| Why | Replit project, managed Postgres, and App Storage still unconfirmed |
| Local schema rehearsal | **PASS** on disposable `scc_phase6b` only |

**STOP.** Awaiting your staging Repl identity + push/publish authorization.
